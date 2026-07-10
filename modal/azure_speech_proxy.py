"""Azure Speech proxy for the Chinese Practice PWA (chinese.html), deployed on Modal.

chinese.html's 🎤 Speak mode and natural-voice playback used to call Azure
Cognitive Services directly from the browser with a subscription key typed
into the app's Speech Settings modal (stored in localStorage). This proxy
moves that key server-side: the browser now only holds a Modal proxy URL and
a proxy token, and this app injects the real Azure key before forwarding.

Same action-based single-endpoint shape as modal/lta_proxy.py:

  POST {url}/?action=STT&language=zh-CN&format=detailed&token=<secret>
    headers: Pronunciation-Assessment: <base64 JSON>, Content-Type: audio/wav...
    body:    raw WAV bytes
    -> forwards to Azure's pronunciation-assessment REST endpoint, returns JSON

  POST {url}/?action=TTS&token=<secret>
    headers: Content-Type: application/ssml+xml, X-Microsoft-OutputFormat (optional)
    body:    SSML text
    -> forwards to Azure TTS, returns raw audio bytes

  GET  {url}/?action=Test&token=<secret>
    -> exercises Azure's issueToken endpoint with the configured key, returns
       {"ok": true|false} so the app's "Test connection" button can validate
       the *proxy* token + Azure key without exposing the Azure key itself.

If PROXY_TOKEN is not set in the secret, the token check is skipped (same
behaviour as the GAS/LTA proxy).

Deploy
------
1. Create the secret (Azure Speech key + region + a proxy token you invent):

     modal secret create azure-speech-proxy-secrets \\
       AZURE_SPEECH_KEY=<your Azure Speech "Key 1"> \\
       AZURE_SPEECH_REGION=southeastasia \\
       PROXY_TOKEN=<any secret string you choose>

   (Optional) restrict CORS to your app origin:

     modal secret create azure-speech-proxy-secrets ... ALLOWED_ORIGINS=https://elvinio.github.io

2. Deploy:

     modal deploy modal/azure_speech_proxy.py

   Modal prints the public URL — paste it into chinese.html's Speech Settings
   modal → "Modal Proxy URL", and the PROXY_TOKEN into "API Key".
"""

import os

import modal

STT_URL_TMPL = "https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1"
TTS_URL_TMPL = "https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
TOKEN_URL_TMPL = "https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"

app = modal.App("azure-speech-proxy")
image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi[standard]==0.115.*", "httpx==0.27.*"
)
secrets = [modal.Secret.from_name("azure-speech-proxy-secrets")]


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
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    def json_out(obj, status_code: int = 200):
        return JSONResponse(obj, status_code=status_code)

    async def handle_stt(request: Request, region: str, api_key: str):
        body = await request.body()
        headers = {
            "Ocp-Apim-Subscription-Key": api_key,
            "Content-Type": request.headers.get("content-type", "audio/wav; codecs=audio/pcm; samplerate=16000"),
            "Accept": "application/json",
        }
        pa = request.headers.get("pronunciation-assessment")
        if pa:
            headers["Pronunciation-Assessment"] = pa
        params = {
            "language": request.query_params.get("language", "zh-CN"),
            "format": request.query_params.get("format", "detailed"),
        }
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(STT_URL_TMPL.format(region=region), params=params, content=body, headers=headers)
        if resp.status_code in (401, 403):
            return json_out({"error": "auth"}, status_code=resp.status_code)
        if resp.status_code != 200:
            return json_out({"error": "server"}, status_code=resp.status_code)
        return Response(content=resp.content, media_type="application/json")

    async def handle_tts(request: Request, region: str, api_key: str):
        body = await request.body()
        headers = {
            "Ocp-Apim-Subscription-Key": api_key,
            "Content-Type": request.headers.get("content-type", "application/ssml+xml"),
            "X-Microsoft-OutputFormat": request.headers.get(
                "x-microsoft-outputformat", "audio-24khz-48kbitrate-mono-mp3"
            ),
        }
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(TTS_URL_TMPL.format(region=region), content=body, headers=headers)
        if resp.status_code != 200:
            return PlainTextResponse(resp.text, status_code=resp.status_code)
        return Response(content=resp.content, media_type=resp.headers.get("content-type", "audio/mpeg"))

    async def handle_test(region: str, api_key: str):
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(TOKEN_URL_TMPL.format(region=region), headers={"Ocp-Apim-Subscription-Key": api_key})
        return json_out({"ok": resp.status_code == 200})

    @web.api_route("/", methods=["GET", "POST", "OPTIONS"])
    async def root(request: Request):
        # CORS preflight: browsers send it without credentials, so it must not
        # require auth. CORSMiddleware adds the Access-Control-* headers.
        if request.method == "OPTIONS":
            return Response(status_code=204)

        params = request.query_params
        expected_token = os.environ.get("PROXY_TOKEN")
        if expected_token and params.get("token") != expected_token:
            return json_out({"error": "Forbidden"}, status_code=403)

        region = os.environ.get("AZURE_SPEECH_REGION")
        api_key = os.environ.get("AZURE_SPEECH_KEY")
        if not region or not api_key:
            return json_out({"error": "AZURE_SPEECH_KEY/AZURE_SPEECH_REGION not set in secret"}, status_code=500)

        action = params.get("action")
        if action == "STT":
            return await handle_stt(request, region, api_key)
        if action == "TTS":
            return await handle_tts(request, region, api_key)
        if action == "Test":
            return await handle_test(region, api_key)
        return json_out({"error": "Unknown action"}, status_code=400)

    return web


@app.function(image=image, secrets=secrets, timeout=30)
@modal.asgi_app()
def fastapi_app():
    return build_app()
