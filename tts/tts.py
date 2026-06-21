import modal

# ---------------------------------------------------------------------------
# Modal image: Python deps + ffmpeg (system pkg) baked into the container.
# Only `modal` is imported at module level — fastapi/kokoro live inside the
# image, so importing them up here would break local `modal serve/deploy`.
# ---------------------------------------------------------------------------
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install("fastapi[standard]", "kokoro", "soundfile", "torch")
)

app = modal.App("kokoro-tts", image=image)

# Store the API key as a Modal secret (never in code):
#   modal secret create tts-api-key TTS_API_KEY=$(openssl rand -hex 32)
api_key_secret = modal.Secret.from_name("tts-api-key")


# ---------------------------------------------------------------------------
# Modal entrypoint: serves a FastAPI app as a web endpoint.
#   modal serve tts/tts.py   # dev (hot reload, temp URL)
#   modal deploy tts/tts.py  # production (persistent URL)
# Add gpu="A10G" to the decorator if you want GPU-accelerated inference.
# ---------------------------------------------------------------------------
@app.function(secrets=[api_key_secret], timeout=600, cpu=2.0)
@modal.concurrent(max_inputs=4)
@modal.asgi_app()
def fastapi_app():
    import os
    import subprocess
    import threading

    from fastapi import Depends, FastAPI, HTTPException, status
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import StreamingResponse
    from fastapi.security import APIKeyHeader
    from pydantic import BaseModel

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

    web_app = FastAPI()

    # The tracker PWA calls this from a different origin (GitHub Pages) with a
    # custom X-API-Key header, so the browser sends a CORS preflight OPTIONS
    # before the POST. Without this middleware that preflight 405s and the POST
    # never fires. Auth is a header (not a cookie), so "*" origins are safe.
    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["POST", "OPTIONS"],
        allow_headers=["X-API-Key", "Content-Type"],
    )

    @web_app.post("/tts", dependencies=[Depends(require_api_key)])
    def tts(req: TTSRequest):
        import torch
        from kokoro import KPipeline

        # With cpu=2.0 and max_inputs=4, cap intra-op threads so 4 concurrent
        # calls don't over-subscribe the 2 cores (4 × default ~4 = 16 threads).
        torch.set_num_threads(1)

        # British voice ids start with bf_/bm_ → lang_code "b"; all others use
        # American English ("a"). Picking the matching phonemizer keeps
        # pronunciation correct for both accents.
        lang_code = "b" if req.voice[:1] == "b" else "a"
        pipeline = KPipeline(lang_code=lang_code)

        # Start ffmpeg process (MP3 encoder)
        ffmpeg = subprocess.Popen(
            [
                "ffmpeg",
                "-y",
                "-f", "f32le",
                "-ar", "24000",
                "-ac", "1",
                "-i", "pipe:0",
                "-codec:a", "libmp3lame",
                "-b:a", "192k",
                "-f", "mp3",
                "pipe:1",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )

        # Feed Kokoro chunks into ffmpeg stdin on a background thread so that
        # the main thread can read ffmpeg stdout concurrently. Without this,
        # ffmpeg's output pipe fills up and blocks before stdin is closed,
        # causing a deadlock on long texts.
        def write_audio():
            try:
                for _, _, audio in pipeline(req.text, voice=req.voice):
                    if hasattr(audio, "cpu"):  # torch.Tensor
                        audio = audio.cpu().numpy()
                    ffmpeg.stdin.write(audio.astype("float32").tobytes())
            finally:
                ffmpeg.stdin.close()

        writer = threading.Thread(target=write_audio, daemon=True)
        writer.start()

        # Yield MP3 chunks as ffmpeg produces them so the client receives data
        # immediately rather than waiting for the full encode to finish.
        def generate():
            try:
                while True:
                    chunk = ffmpeg.stdout.read(16384)
                    if not chunk:
                        break
                    yield chunk
            finally:
                writer.join(timeout=30)
                ffmpeg.wait()

        return StreamingResponse(generate(), media_type="audio/mpeg")

    return web_app
