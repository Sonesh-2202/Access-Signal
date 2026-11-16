"""Serve frontend/dist the way GitHub Pages does, to test a Pages build locally.

    cd frontend
    VITE_BASE_PATH=/Access-Signal/ VITE_API_BASE=http://localhost:8001 npx vite build
    cp dist/index.html dist/404.html
    python ../scripts/pages_preview.py --base /Access-Signal/ --port 4180

Like Pages: files are served under the base path, unknown paths get 404.html with a
404 status (that is what makes deep links such as /Access-Signal/map work on refresh),
and nothing is proxied, so the app must reach the API cross-origin via VITE_API_BASE."""

import argparse
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(Path(__file__).resolve().parents[1] / "frontend" / "dist"))
    ap.add_argument("--base", default="/")
    ap.add_argument("--port", type=int, default=4180)
    args = ap.parse_args()
    root = Path(args.dir).resolve()
    base = "/" + args.base.strip("/") + "/" if args.base.strip("/") else "/"

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            path = unquote(urlsplit(self.path).path)
            if not path.startswith(base) and path + "/" != base:
                return self._send(root / "404.html", 404)
            rel = path[len(base):] if path.startswith(base) else ""
            target = (root / rel).resolve()
            if target.is_dir():
                target = target / "index.html"
            if not target.is_relative_to(root) or not target.is_file():
                return self._send(root / "404.html", 404)
            self._send(target, 200)

        def _send(self, file: Path, code: int):
            data = file.read_bytes() if file.is_file() else b"Not found"
            self.send_response(code)
            self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    print(f"Serving {root} at http://localhost:{args.port}{base}")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
