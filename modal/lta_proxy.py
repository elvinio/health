"""LTA Bus + NEA rain-radar proxy for the Finance PWA, deployed on Modal.

Modal port of apps-script/lta-proxy.gs. Kept API-compatible with the GAS
version so the Finance PWA needs no code changes — only the "Proxy URL"
field in Bus API Setup has to be repointed at this app's URL. Same query
params, same actions, same JSON shapes:

  GET {url}?action=BusArrival&stops=83139,12345&token=<secret>
  GET {url}?action=BusStopCoords&stops=83139,12345&token=<secret>
  GET {url}?action=RainList&token=<secret>
  GET {url}?action=RainImg&t=202606090800&token=<secret>

If PROXY_TOKEN is not set in the secret, the token check is skipped (same
behaviour as the GAS version).

Unlike the GAS version (which can only return JSON, hence its base64
RainImg/RainImgBatch encoding), this app can serve binary directly: RainImg
returns the raw PNG bytes with an immutable Cache-Control header, and there
is no batch variant — the client fetches whatever frames it needs in
parallel instead of one combined request.

── Rain radar cache ──
A scheduled Modal function (`cache_rain_frame`, every 5 min) fetches the
newest NEA rain-radar frame and writes it to a Modal Volume, mirroring the
GAS version's Drive-folder ring buffer: frames are named <yyyyMMddHHmm>.png
and stored in a day-of-month subfolder ("01".."31"), so a bucket is reused
~30 days later and the first write of a new day just wipes that one small
folder instead of scanning the whole cache.

Deploy
------
1. Create the secret (LTA API key + optional shared token the PWA sends):

     modal secret create lta-proxy-secrets \\
       LTA_API_KEY=<your LTA DataMall AccountKey> \\
       PROXY_TOKEN=<any secret string you choose>

   (Optional) restrict CORS to your app origin:

     modal secret create lta-proxy-secrets ... ALLOWED_ORIGINS=https://elvinio.github.io

2. Deploy:

     modal deploy modal/lta_proxy.py

   Modal prints the public URL — paste it into the Finance PWA's
   Bus API Setup → "Proxy URL" field (same PROXY_TOKEN as the token field).
   The `cache_rain_frame` schedule starts running immediately; no separate
   "install trigger" step is needed (unlike the GAS version).
"""

import asyncio
import os
import re
from datetime import datetime, timedelta, timezone

import modal

RAIN_URL_PREFIX = "https://www.weather.gov.sg/files/rainarea/50km/v2/dpsri_70km_"
RAIN_URL_SUFFIX = "0000dBR.dpsri.png"
BUS_ARRIVAL_URL = "https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival"
BUS_STOPS_URL = "https://datamall2.mytransport.sg/ltaodataservice/BusStops"

CACHE_DIR = "/cache"
RAIN_RETENTION_DAYS = 30
SGT = timezone(timedelta(hours=8))

app = modal.App("lta-proxy")
image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi[standard]==0.115.*", "httpx==0.27.*"
)
volume = modal.Volume.from_name("lta-rain-cache", create_if_missing=True)
secrets = [modal.Secret.from_name("lta-proxy-secrets")]


# ── SGT slot-key helpers (same ring-buffer scheme as the GAS version) ───────

def sgt_slot_key(dt: datetime, offset_slots: int = 0) -> str:
    """yyyyMMddHHmm, minutes floored to a 5-min boundary, stepped back
    offset_slots x 5 min."""
    dt = dt.astimezone(SGT) - timedelta(minutes=5 * offset_slots)
    floored_minute = dt.minute - (dt.minute % 5)
    dt = dt.replace(minute=floored_minute, second=0, microsecond=0)
    return dt.strftime("%Y%m%d%H%M")


def bucket_dir(dd: str) -> str:
    return os.path.join(CACHE_DIR, dd)


def rollover_bucket(dd: str, ym: str) -> None:
    """If the bucket's existing frames belong to a different month than `ym`
    (yyyyMM), the day has rolled over — wipe it so the day is reused."""
    d = bucket_dir(dd)
    if not os.path.isdir(d):
        return
    names = os.listdir(d)
    if not names or names[0][:6] == ym:
        return
    for name in names:
        os.remove(os.path.join(d, name))


# ── Scheduled rain-frame fetch (replaces GAS's installRainTrigger) ─────────

@app.function(image=image, volumes={CACHE_DIR: volume}, schedule=modal.Period(minutes=5), timeout=60)
def cache_rain_frame():
    import httpx

    now = datetime.now(timezone.utc)
    with httpx.Client(timeout=15) as client:
        for offset in range(3):  # NEA publishes with a lag; fall back up to 2 slots
            key = sgt_slot_key(now, offset)
            dd = key[6:8]
            d = bucket_dir(dd)
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, f"{key}.png")
            if os.path.exists(path):
                return  # newest slot already cached
            resp = client.get(f"{RAIN_URL_PREFIX}{key}{RAIN_URL_SUFFIX}")
            if resp.status_code == 200 and resp.headers.get("content-type", "").startswith("image"):
                rollover_bucket(dd, key[:6])
                with open(path, "wb") as f:
                    f.write(resp.content)
                volume.commit()
                return


# ── FastAPI app (replaces GAS's doGet) ──────────────────────────────────────

def build_app():
    from fastapi import FastAPI, Request, Response
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, PlainTextResponse
    import httpx

    web = FastAPI()
    origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
    web.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["*"],
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    def json_out(obj):
        return JSONResponse(obj)

    async def handle_bus_arrival(stops: str, api_key: str):
        codes = [s.strip() for s in stops.split(",") if s.strip()]
        if not codes:
            return json_out({"error": "No stop codes provided"})
        headers = {"AccountKey": api_key, "accept": "application/json"}
        async with httpx.AsyncClient(timeout=15) as client:
            responses = await asyncio.gather(
                *[client.get(BUS_ARRIVAL_URL, params={"BusStopCode": c}, headers=headers) for c in codes],
                return_exceptions=True,
            )
        result = {}
        for code, resp in zip(codes, responses):
            try:
                result[code] = resp.json()
            except Exception:
                result[code] = {"error": "Parse error"}
        return json_out(result)

    async def handle_bus_stop_coords(stops: str, api_key: str):
        codes = {s.strip() for s in stops.split(",") if s.strip()}
        if not codes:
            return json_out({"error": "No stop codes provided"})
        headers = {"AccountKey": api_key, "accept": "application/json"}
        # Page through the full BusStops dataset in parallel (~21 pages x 500 stops).
        async with httpx.AsyncClient(timeout=15) as client:
            responses = await asyncio.gather(
                *[
                    client.get(BUS_STOPS_URL, params={"$skip": skip}, headers=headers)
                    for skip in range(0, 10500, 500)
                ],
                return_exceptions=True,
            )
        result = {}
        for resp in responses:
            if isinstance(resp, Exception):
                continue
            try:
                for s in resp.json().get("value", []):
                    if s.get("BusStopCode") in codes:
                        result[s["BusStopCode"]] = {
                            "lat": s.get("Latitude"),
                            "lng": s.get("Longitude"),
                            "name": s.get("Description"),
                        }
            except Exception:
                pass
        return json_out(result)

    async def handle_rain_list():
        await volume.reload.aio()
        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=RAIN_RETENTION_DAYS)
        cutoff_key = sgt_slot_key(cutoff_dt, 0)
        frames = []
        if os.path.isdir(CACHE_DIR):
            for dd in os.listdir(CACHE_DIR):
                d = bucket_dir(dd)
                if not os.path.isdir(d):
                    continue
                for name in os.listdir(d):
                    m = re.match(r"^(\d{12})\.png$", name)
                    if m and m.group(1) >= cutoff_key:
                        frames.append(m.group(1))
        frames.sort()
        return json_out({"frames": frames})

    def _read_frame(key: str):
        if not re.match(r"^\d{12}$", key):
            return None
        path = os.path.join(bucket_dir(key[6:8]), f"{key}.png")
        if not os.path.exists(path):
            return None
        with open(path, "rb") as f:
            return f.read()

    # Frames are immutable once written, so the response can be cached
    # indefinitely by both the browser and the client's own persistent store.
    RAIN_IMG_CACHE_HEADERS = {"Cache-Control": "public, max-age=31536000, immutable"}

    async def handle_rain_img(t: str):
        await volume.reload.aio()
        if not t or not re.match(r"^\d{12}$", t):
            return PlainTextResponse("Bad t parameter", status_code=400)
        data = _read_frame(t)
        if data is None:
            return PlainTextResponse("Not found", status_code=404)
        return Response(content=data, media_type="image/png", headers=RAIN_IMG_CACHE_HEADERS)

    @web.get("/")
    async def root(request: Request):
        params = request.query_params

        expected_token = os.environ.get("PROXY_TOKEN")
        if expected_token and params.get("token") != expected_token:
            return json_out({"error": "Forbidden"})

        action = params.get("action")

        # Rain actions need only the Volume, not the LTA key.
        if action == "RainList":
            return await handle_rain_list()
        if action == "RainImg":
            return await handle_rain_img(params.get("t", ""))

        api_key = os.environ.get("LTA_API_KEY")
        if not api_key:
            return json_out({"error": "LTA_API_KEY not set in secret"})

        if action == "BusArrival":
            return await handle_bus_arrival(params.get("stops", ""), api_key)
        if action == "BusStopCoords":
            return await handle_bus_stop_coords(params.get("stops", ""), api_key)

        return json_out({"error": "Unknown action"})

    return web


@app.function(image=image, secrets=secrets, volumes={CACHE_DIR: volume}, timeout=60)
@modal.asgi_app()
def fastapi_app():
    return build_app()
