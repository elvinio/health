import modal

# ---------------------------------------------------------------------------
# Modal image: Python deps + ffmpeg (system pkg) baked into the container.
# Only `modal` is imported at module level — fastapi/kokoro live inside the
# image, so importing them up here would break local `modal serve/deploy`.
# ---------------------------------------------------------------------------

# Download both Kokoro pipeline models into the image layer at build time so
# cold-start containers have the weights on disk and skip the network fetch.
def _download_models():
    from kokoro import KPipeline
    KPipeline(lang_code="a")
    KPipeline(lang_code="b")
    KPipeline(lang_code="z")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install(
        "fastapi[standard]", "kokoro", "soundfile", "torch",
        # misaki[zh] extras — listed explicitly because kokoro pins misaki
        # without the [zh] extra, so pip skips re-installing it with extras.
        "addict", "cn2an", "jieba", "ordered_set", "proces",
        "pypinyin", "pypinyin-dict", "regex",
    )
    .run_function(_download_models)
)

app = modal.App("kokoro-tts", image=image)

# Store the API key as a Modal secret (never in code):
#   modal secret create tts-api-key TTS_API_KEY=$(openssl rand -hex 32)
api_key_secret = modal.Secret.from_name("tts-api-key")

# "a" (American English) is the default/most-used voice (af_bella), so it
# gets a pool of independent pipeline instances for real parallel inference.
# "b"/"z" stay single-instance — see the pool comment below for why separate
# instances (not just more threads) are what buys the parallelism.
POOL_SIZE_A = 3

# ---------------------------------------------------------------------------
# Audio cache (Modal Volume).
#
# /tts is a streaming endpoint: audio is synthesized, encoded and pushed to the
# socket in one pass, so a dropped connection used to throw away every byte and
# force a full re-synthesis. The cache makes the job idempotent instead —
# results are content-addressed by sha256(text, voice, speed, format), the
# encode runs OFF the request path (so a disconnect no longer cancels it), and
# the finished blob is served range-capably from `GET /tts/{key}.{ext}`. A
# client that drops mid-download resumes from its byte offset rather than
# paying for inference twice.
# ---------------------------------------------------------------------------
CACHE_DIR = "/cache"
CACHE_MAX_BYTES = 2 * 1024**3   # ~2 GB; oldest blobs are evicted past this
PART_TTL_SECONDS = 3600         # orphaned .part files from crashed workers

cache_volume = modal.Volume.from_name("kokoro-tts-cache", create_if_missing=True)


# ---------------------------------------------------------------------------
# Modal entrypoint: serves a FastAPI app as a web endpoint.
#   modal serve tts/tts.py   # dev (hot reload, temp URL)
#   modal deploy tts/tts.py  # production (persistent URL)
# Add gpu="A10G" to the decorator if you want GPU-accelerated inference.
# cpu scales with POOL_SIZE_A (one core per concurrent "a" inference);
# memory covers POOL_SIZE_A+2 loaded pipelines (~350MB each) plus the
# Torch/FastAPI/ffmpeg overhead.
# ---------------------------------------------------------------------------
@app.function(
    secrets=[api_key_secret],
    volumes={CACHE_DIR: cache_volume},
    timeout=600,
    cpu=float(POOL_SIZE_A),
    memory=4096,
)
@modal.concurrent(max_inputs=POOL_SIZE_A + 2)
@modal.asgi_app()
def fastapi_app():
    import hashlib
    import json
    import os
    import queue
    import re
    import subprocess
    import threading
    import time
    import uuid

    import torch
    from kokoro import KPipeline
    from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import StreamingResponse
    from fastapi.security import APIKeyHeader
    from pydantic import BaseModel
    from typing import Literal, Optional

    # Each pipeline instance stays single-threaded — parallelism comes from
    # running multiple separate instances (the pool below) across that many
    # cores, not from giving one instance more threads.
    torch.set_num_threads(1)

    # Pre-create pipelines once per container. KPipeline lazily caches loaded
    # voices in an unsynchronized `self.voices` dict, so concurrent requests
    # sharing ONE instance can race — a pool of independent instances (queued
    # like a bounded semaphore) sidesteps that while letting POOL_SIZE_A "a"
    # requests actually run inference in parallel. "b"/"z" see far less
    # traffic so a single instance (pool of 1) is enough.
    _pipelines_by_code = {
        "a": [KPipeline(lang_code="a") for _ in range(POOL_SIZE_A)],
        "b": [KPipeline(lang_code="b")],
        "z": [KPipeline(lang_code="z")],
    }
    _pipeline_pool = {code: queue.Queue() for code in _pipelines_by_code}
    for code, pipelines in _pipelines_by_code.items():
        for p in pipelines:
            _pipeline_pool[code].put(p)

    # Patch lexicon.golds to override misidentified pronunciations.
    # "breathed" is stored as 'bɹˈɛθt' (the rare adjective form meaning
    # "unvoiced") but in practice it's always the verb past tense of "breathe".
    _PRON_OVERRIDES = {
        "a": {"breathed": "bɹˈiðd"},    # US: /briːðd/
        "b": {"breathed": "bɹˈiːðd"},   # GB: /briːðd/
    }
    for code, overrides in _PRON_OVERRIDES.items():
        for pipeline in _pipelines_by_code[code]:
            g = pipeline.g2p.lexicon.golds
            for word, phonemes in overrides.items():
                g[word] = phonemes
                g[word.capitalize()] = phonemes

    # ffmpeg settings per output format. The dict key doubles as the cache-file
    # extension, so `GET /tts/{key}.opus` maps straight back to a format here.
    _FORMAT = {
        "opus": {
            "codec": "libopus",
            "bitrate": "48k",
            "container": "ogg",
            "media_type": "audio/ogg",
        },
        "mp3": {
            "codec": "libmp3lame",
            "bitrate": "128k",
            "container": "mp3",
            "media_type": "audio/mpeg",
        },
    }

    # API-key auth: clients send `X-API-Key: <key>`.
    api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

    def require_api_key(provided: str = Depends(api_key_header)) -> None:
        expected = os.environ.get("TTS_API_KEY")
        if not expected or provided != expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing API key",
            )

    class TTSRequest(BaseModel):
        text: str
        voice: str = "af_bella"
        format: Literal["opus", "mp3"] = "opus"
        speed: float = 1.0

    # ── Cache plumbing ──────────────────────────────────────────────────────

    AUDIO_DIR = os.path.join(CACHE_DIR, "audio")   # finished blobs: {key}.{ext}
    PART_DIR = os.path.join(CACHE_DIR, "parts")    # in-progress encodes
    os.makedirs(AUDIO_DIR, exist_ok=True)
    os.makedirs(PART_DIR, exist_ok=True)

    # Bump to invalidate every cached blob at once — do this after changing
    # _PRON_OVERRIDES, the ffmpeg bitrate, or anything else that alters output
    # for an unchanged request.
    CACHE_VERSION = 1

    _KEY_RE = re.compile(r"[0-9a-f]{64}")

    def cache_key(text, voice, speed, fmt):
        payload = json.dumps(
            [CACHE_VERSION, text, voice, round(float(speed), 4), fmt],
            ensure_ascii=False, separators=(",", ":"),
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    # Volume writes only become visible to *other* containers after commit(),
    # and only visible *here* after reload(). Reload on cache misses so we
    # don't re-synthesize something a sibling container already produced, but
    # rate-limit it — most misses are genuinely new text. reload() raises if
    # this container holds open files on the volume (a concurrent download),
    # so failure is non-fatal: worst case we regenerate.
    _reload_lock = threading.Lock()
    _last_reload = [0.0]
    RELOAD_MIN_INTERVAL = 5.0

    def reload_cache():
        with _reload_lock:
            if time.monotonic() - _last_reload[0] < RELOAD_MIN_INTERVAL:
                return
            _last_reload[0] = time.monotonic()
        try:
            cache_volume.reload()
        except Exception:
            pass

    def prune_cache():
        """Evict oldest blobs past the byte budget; sweep orphaned .part files.

        FIFO rather than LRU on purpose: refreshing mtime on every cache hit
        would make Modal re-upload the blob on the next commit.
        """
        now = time.time()
        for name in os.listdir(PART_DIR):
            path = os.path.join(PART_DIR, name)
            try:
                if now - os.stat(path).st_mtime > PART_TTL_SECONDS:
                    os.remove(path)
            except OSError:
                pass
        entries, total = [], 0
        for name in os.listdir(AUDIO_DIR):
            path = os.path.join(AUDIO_DIR, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            entries.append((st.st_mtime, st.st_size, path))
            total += st.st_size
        if total <= CACHE_MAX_BYTES:
            return
        for _, size, path in sorted(entries):
            if total <= CACHE_MAX_BYTES:
                break
            try:
                os.remove(path)
                total -= size
            except OSError:
                pass

    # ── Background encode jobs ──────────────────────────────────────────────

    class Job:
        """One in-flight synthesis. Readers tail `part_path` until `done`."""

        def __init__(self, key, ext):
            self.key = key
            self.part_path = os.path.join(PART_DIR, f"{key}.{uuid.uuid4().hex}.part")
            self.final_path = os.path.join(AUDIO_DIR, f"{key}.{ext}")
            self.done = threading.Event()
            self.ok = False

    _jobs = {}
    _jobs_lock = threading.Lock()

    def run_job(job, req):
        """Synthesize → encode → part file → atomic rename into the cache.

        Deliberately off the request path: if the client disconnects
        mid-download the encode still finishes, so the retry is a cache hit
        instead of a second full inference pass. (The container has to outlive
        the request for that to land — it normally does, and if it scales down
        first the only cost is a missing cache entry.)
        """
        # Route to the matching phonemizer pipeline by voice ID prefix:
        #   zf_/zm_ → Chinese ("z"), bf_/bm_ → British ("b"), else American ("a").
        prefix = req.voice[:2]
        if prefix in ("zf", "zm"):
            lang_code = "z"
        elif prefix in ("bf", "bm"):
            lang_code = "b"
        else:
            lang_code = "a"
        pool = _pipeline_pool[lang_code]
        fmt = _FORMAT[req.format]
        ok = False
        ffmpeg = None
        try:
            ffmpeg = subprocess.Popen(
                [
                    "ffmpeg",
                    "-y",
                    "-f", "f32le",
                    "-ar", "24000",
                    "-ac", "1",
                    "-i", "pipe:0",
                    "-codec:a", fmt["codec"],
                    "-b:a", fmt["bitrate"],
                    "-f", fmt["container"],
                    "pipe:1",
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )

            # Feed Kokoro chunks into ffmpeg stdin on a background thread so
            # that this thread can read ffmpeg stdout concurrently. Without
            # this, ffmpeg's output pipe fills up and blocks before stdin is
            # closed, causing a deadlock on long texts.
            errors = []

            def write_audio():
                pipeline = pool.get()
                try:
                    for _, _, audio in pipeline(req.text, voice=req.voice, speed=req.speed):
                        if hasattr(audio, "cpu"):  # torch.Tensor
                            audio = audio.cpu().numpy()
                        ffmpeg.stdin.write(audio.astype("float32").tobytes())
                except BaseException as exc:      # noqa: BLE001 — recorded, not swallowed
                    errors.append(exc)
                finally:
                    pool.put(pipeline)
                    try:
                        ffmpeg.stdin.close()
                    except OSError:
                        pass

            writer = threading.Thread(target=write_audio, daemon=True)
            writer.start()

            with open(job.part_path, "wb") as out:
                try:
                    while True:
                        chunk = ffmpeg.stdout.read(16384)
                        if not chunk:
                            break
                        out.write(chunk)
                        out.flush()
                finally:
                    ffmpeg.stdout.close()   # long-lived container: don't leak fds
            writer.join(timeout=30)
            ffmpeg.wait()

            # A mid-inference failure closes stdin cleanly, so ffmpeg happily
            # exits 0 on a TRUNCATED stream. `errors` is what separates that
            # from a real completion — without it we'd cache half an episode
            # permanently.
            ok = (
                not errors
                and ffmpeg.returncode == 0
                and os.path.getsize(job.part_path) > 0
            )
            if ok:
                os.replace(job.part_path, job.final_path)
                prune_cache()
                try:
                    cache_volume.commit()
                except Exception:
                    pass          # blob still served from this container's disk
        except Exception:
            ok = False
        finally:
            if ffmpeg is not None:
                for pipe in (ffmpeg.stdin, ffmpeg.stdout):
                    try:
                        if pipe is not None:
                            pipe.close()
                    except OSError:
                        pass
                if ffmpeg.poll() is None:
                    ffmpeg.kill()
                    ffmpeg.wait()
            if not ok:
                try:
                    os.remove(job.part_path)
                except OSError:
                    pass
            job.ok = ok
            # Set before de-registering: a reader that grabbed this Job still
            # holds its own reference and needs the completion signal.
            job.done.set()
            with _jobs_lock:
                if _jobs.get(job.key) is job:
                    del _jobs[job.key]

    def get_or_start_job(key, req):
        """Attach to the encode already running for `key`, or start one.

        Deduplication is what makes an immediate retry cheap: the reconnect
        lands on the running job and tails its part file instead of kicking
        off a second inference for identical text.
        """
        with _jobs_lock:
            job = _jobs.get(key)
            if job is not None:
                return job, False
            job = Job(key, req.format)
            _jobs[key] = job
        threading.Thread(target=run_job, args=(job, req), daemon=True).start()
        return job, True

    POLL_INTERVAL = 0.05
    OPEN_TIMEOUT = 60.0

    def stream_job(job):
        """Yield the encode's bytes as the worker appends them.

        Opening the part file is enough to survive the rename that completes
        the job — the fd follows the inode, so a reader that started early
        keeps reading straight through to EOF.
        """
        handle = None
        deadline = time.monotonic() + OPEN_TIMEOUT
        while handle is None:
            for path in (job.part_path, job.final_path):
                try:
                    handle = open(path, "rb")
                    break
                except OSError:
                    continue
            if handle is not None:
                break
            if job.done.is_set() or time.monotonic() > deadline:
                return        # failed before producing anything → empty body
            time.sleep(POLL_INTERVAL)
        try:
            while True:
                chunk = handle.read(65536)
                if chunk:
                    yield chunk
                    continue
                if job.done.is_set():
                    if not job.ok:
                        return    # don't hand back a truncated encode
                    chunk = handle.read(65536)   # bytes written just before done
                    if not chunk:
                        return
                    yield chunk
                    continue
                time.sleep(POLL_INTERVAL)
        finally:
            handle.close()

    # ── Range-capable file serving ──────────────────────────────────────────

    def parse_range(header, size):
        """-> (start, end) | "ignore" | None (unsatisfiable → 416).

        Single ranges only; anything unparsable is ignored per RFC 9110, which
        says to serve the full representation rather than fail.
        """
        if not header or not header.startswith("bytes=") or "," in header:
            return "ignore"
        spec = header[len("bytes="):].strip()
        first, sep, last = spec.partition("-")
        if not sep:
            return "ignore"
        try:
            if not first:                       # suffix range: bytes=-N
                length = int(last)
                if length <= 0:
                    return None
                return max(0, size - length), size - 1
            start = int(first)
            end = int(last) if last else size - 1
        except ValueError:
            return "ignore"
        if start >= size or start > end:
            return None
        return start, min(end, size - 1)

    def read_range(path, start, end):
        with open(path, "rb") as handle:
            handle.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = handle.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    def serve_cached(path, media_type, range_header, extra_headers):
        size = os.path.getsize(path)
        headers = {"Accept-Ranges": "bytes", **extra_headers}
        wanted = parse_range(range_header, size)
        if wanted is None:
            headers["Content-Range"] = f"bytes */{size}"
            return Response(status_code=416, headers=headers)
        code = status.HTTP_200_OK
        start, end = 0, size - 1
        if wanted != "ignore":
            start, end = wanted
            code = status.HTTP_206_PARTIAL_CONTENT
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        headers["Content-Length"] = str(end - start + 1)
        return StreamingResponse(
            read_range(path, start, end),
            status_code=code,
            media_type=media_type,
            headers=headers,
        )

    # ── Routes ──────────────────────────────────────────────────────────────

    web_app = FastAPI()

    # The tracker PWA calls this from a different origin (GitHub Pages) with a
    # custom X-API-Key header, so the browser sends a CORS preflight OPTIONS
    # before the POST. Without this middleware that preflight 405s and the POST
    # never fires. Auth is a header (not a cookie), so "*" origins are safe.
    # expose_headers is what lets the PWA actually read X-TTS-Key off the
    # response — without it the resume URL is invisible to the client.
    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "HEAD", "POST", "OPTIONS"],
        allow_headers=["X-API-Key", "Content-Type", "Range"],
        expose_headers=[
            "X-TTS-Key", "X-TTS-Cache", "Accept-Ranges", "Content-Range", "Content-Length",
        ],
    )

    @web_app.post("/tts", dependencies=[Depends(require_api_key)])
    def tts(req: TTSRequest, range_header: Optional[str] = Header(None, alias="Range")):
        if req.format not in _FORMAT:
            raise HTTPException(status_code=400, detail="Unsupported format")
        fmt = _FORMAT[req.format]
        key = cache_key(req.text, req.voice, req.speed, req.format)
        final_path = os.path.join(AUDIO_DIR, f"{key}.{req.format}")
        headers = {"X-TTS-Key": key, "Accept-Ranges": "bytes"}

        # Already encoded → serve the blob, honouring Range.
        if not os.path.exists(final_path):
            reload_cache()
        if os.path.exists(final_path):
            return serve_cached(
                final_path, fmt["media_type"], range_header,
                {**headers, "X-TTS-Cache": "hit"},
            )

        # Otherwise stream the encode as it happens. Range can't be honoured
        # here (no known length until the encode ends) — clients resume via
        # GET /tts/{key}.{ext} once the blob lands.
        job, started = get_or_start_job(key, req)
        headers["X-TTS-Cache"] = "miss" if started else "inflight"
        return StreamingResponse(
            stream_job(job), media_type=fmt["media_type"], headers=headers,
        )

    @web_app.get("/tts/{key}.{ext}", dependencies=[Depends(require_api_key)])
    def tts_cached(
        key: str, ext: str, range_header: Optional[str] = Header(None, alias="Range")
    ):
        """Range-capable read of a finished blob — the resume path.

        Clients keep the X-TTS-Key from their POST; if the download drops they
        reconnect here with `Range: bytes=<received>-` instead of paying for
        the synthesis again.
        """
        if ext not in _FORMAT or not _KEY_RE.fullmatch(key):
            raise HTTPException(status_code=404, detail="Not found")
        path = os.path.join(AUDIO_DIR, f"{key}.{ext}")
        if not os.path.exists(path):
            reload_cache()
        if not os.path.exists(path):
            with _jobs_lock:
                pending = key in _jobs
            raise HTTPException(
                status_code=404,
                detail="Still encoding" if pending else "Not cached",
            )
        return serve_cached(
            path, _FORMAT[ext]["media_type"], range_header,
            {"X-TTS-Key": key, "X-TTS-Cache": "hit"},
        )

    return web_app
