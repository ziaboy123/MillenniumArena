# Local preview server for the mockups: like `python3 -m http.server`, but tells the browser never to cache,
# so edits show up on a normal refresh.   python3 serve.py [port]
import functools, http.server, pathlib, sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 3016
handler = functools.partial(NoCache, directory=str(pathlib.Path(__file__).parent))
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
