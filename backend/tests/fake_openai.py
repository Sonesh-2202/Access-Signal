"""A tiny OpenAI-compatible server on a free local port, for provider tests.

Behaviour is set per test via attributes on the server object:
    reply            dict returned as the model's JSON answer
    route_intent_reply  reply to the route-intent request only (its system prompt has ROUTE_INTENT)
    reject_images    400 for any request that contains an image part
    reject_schema    400 for any request with response_format
    status           force this HTTP status on /chat/completions
    models           ids listed by GET /models
Every request body and Authorization header is recorded in `calls`."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_REPLY = {
    "category": "ramp", "subcategory": "blocked_ramp", "severity": 0.9,
    "summary": "Delivery truck parked across the ramp.", "detected_features": ["delivery truck", "ramp"],
    "confidence": 0.85,
}


class FakeOpenAI(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), _Handler)
        self.reply: dict | str = dict(DEFAULT_REPLY)
        self.route_intent_reply: dict | str | None = None  # reply to a route-intent request, if set
        self.reject_images = False
        self.reject_schema = False
        self.status: int | None = None
        self.models = ["fake-model"]
        self.calls: list[dict] = []
        self._thread = threading.Thread(target=self.serve_forever, daemon=True)

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/v1"

    def start(self) -> "FakeOpenAI":
        self._thread.start()
        return self

    def stop(self) -> None:
        self.shutdown()
        self.server_close()

    def chat_calls(self) -> list[dict]:
        return [c for c in self.calls if c["path"].endswith("/chat/completions")]


def has_image(body: dict) -> bool:
    for m in body.get("messages", []):
        if isinstance(m.get("content"), list) and any(p.get("type") == "image_url" for p in m["content"]):
            return True
    return False


class _Handler(BaseHTTPRequestHandler):
    server: FakeOpenAI

    def log_message(self, *args):  # keep test output quiet
        pass

    def _send(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.server.calls.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": None})
        if self.path.endswith("/models"):
            return self._send(200, {"object": "list", "data": [{"id": m} for m in self.server.models]})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        self.server.calls.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
        s = self.server
        if s.status:
            return self._send(s.status, {"error": {"message": "forced"}})
        if s.reject_images and has_image(body):
            return self._send(400, {"error": {"message": "this model does not support image input"}})
        if s.reject_schema and "response_format" in body:
            return self._send(400, {"error": {"message": "response_format not supported"}})
        reply = s.reply
        if s.route_intent_reply is not None and "ROUTE_INTENT" in json.dumps(body.get("messages", [])[:1]):
            reply = s.route_intent_reply  # the route-intent call gets its own scripted answer
        content = reply if isinstance(reply, str) else json.dumps(reply)
        self._send(200, {"choices": [{"index": 0, "message": {"role": "assistant", "content": content}}]})
