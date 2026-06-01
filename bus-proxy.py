"""
Local CORS proxy for LTA DataMall API.

Keeps the AccountKey header on localhost only — the browser never sends it
to a third-party service like corsproxy.io.

Usage:
  pip install flask requests
  python bus-proxy.py

Then set "Local proxy URL" to http://localhost:8765 in the bus panel settings.
"""
from flask import Flask, request, Response
import requests

app = Flask(__name__)
PORT = 8765


@app.after_request
def add_cors(resp):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Headers'] = 'AccountKey, Content-Type'
    return resp


@app.route('/proxy')
def proxy():
    url = request.args.get('url', '').strip()
    if not url or not url.startswith('https://datamall2.mytransport.sg/'):
        return Response('Bad request', status=400)
    api_key = request.headers.get('AccountKey', '')
    headers = {'accept': 'application/json'}
    if api_key:
        headers['AccountKey'] = api_key
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        return Response(resp.content, status=resp.status_code,
                        content_type='application/json')
    except requests.RequestException as e:
        return Response(str(e), status=502)


if __name__ == '__main__':
    print(f'Bus proxy running on http://localhost:{PORT}')
    app.run(host='127.0.0.1', port=PORT)
