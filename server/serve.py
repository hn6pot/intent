"""Local review server for the `intent` mod: serves the review page and its JSON
on 127.0.0.1 behind a token, and writes one JSON line per event on stdout.

Standard library only (Python 3.7+). stdout carries nothing but event lines;
errors go to stderr.
"""

import argparse
import hmac
import json
import os
import re
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

MAX_BODY_BYTES = 64 * 1024
MAX_SELECTION_CHARS = 4000
VIEWER_INTERVAL_SECONDS = 10.0
PARENT_CHECK_SECONDS = 2.0
TOKEN_PATTERN = re.compile(r"[0-9a-f]{32}")

# Route -> (fixed file name inside the page folder, content type). Request
# paths are never joined to a directory: only these names are ever opened.
PAGE_ROUTES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/render.js": ("render.js", "text/javascript; charset=utf-8"),
    "/answers.js": ("answers.js", "text/javascript; charset=utf-8"),
    "/escape.js": ("escape.js", "text/javascript; charset=utf-8"),
    "/texts.js": ("texts.js", "text/javascript; charset=utf-8"),
    "/select.js": ("select.js", "text/javascript; charset=utf-8"),
}
REVIEW_FILE = "review.json"
JSON_TYPE = "application/json; charset=utf-8"


class Events(object):
    """Writes event lines to stdout (flushed) and rate-limits the viewer signal."""

    def __init__(self, stream, on_failure):
        self._stream = stream
        self._on_failure = on_failure
        self._write_lock = threading.Lock()
        self._last_viewer = None
        self._failed = False

    def emit(self, event):
        """Write one event line; False when stdout is gone (the server is then asked to stop)."""
        data = (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8")
        with self._write_lock:
            if self._failed:
                return False
            try:
                self._stream.write(data)
                self._stream.flush()
                return True
            except (OSError, ValueError):  # broken pipe, closed stream
                self._failed = True
        self._on_failure()
        warn("stdout is gone, stopping")
        return False

    def viewer(self):
        now = time.monotonic()
        with self._write_lock:
            if self._last_viewer is not None and now - self._last_viewer < VIEWER_INTERVAL_SECONDS:
                return
            self._last_viewer = now
        self.emit({"type": "viewer"})


def warn(message):
    """Best-effort note on stderr: when the parent is gone stderr is dead too, and that must not matter."""
    try:
        sys.stderr.write("intent server: %s\n" % message)
        sys.stderr.flush()
    except (OSError, ValueError):
        pass


def is_text(value):
    """A string that survives strict UTF-8 encoding (JSON can carry lone surrogates)."""
    if not isinstance(value, str):
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def optional_text(value):
    return value is None or is_text(value)


def is_line(value):
    """A line number: an integer from 1 (a JSON true is not one)."""
    return isinstance(value, int) and not isinstance(value, bool) and value >= 1


def selection_event(body):
    """Selected lines of one file: `1 <= from <= to`, their text 4 000 characters at most."""
    root, path, start, end, text = (body.get(k) for k in ("root", "path", "from", "to", "text"))
    if not is_text(root) or not is_text(path) or path == "" or not is_text(text) or len(text) > MAX_SELECTION_CHARS:
        return None
    if not is_line(start) or not is_line(end) or start > end:
        return None
    return {"type": "ask", "kind": "selection", "root": root, "path": path, "from": start, "to": end, "text": text}


def ask_event(body):
    """Build the `ask` event from a request body, or None when it is malformed."""
    if body.get("kind") == "selection":
        return selection_event(body)
    kind, root, text = body.get("kind"), body.get("root"), body.get("text")
    path, hunk = body.get("path"), body.get("hunk")
    if kind not in ("here", "free") or not is_text(root) or not is_text(text):
        return None
    if not optional_text(path) or not optional_text(hunk):
        return None
    return {"type": "ask", "kind": kind, "root": root, "path": path, "hunk": hunk, "text": text}


def root_event(event_type):
    def build(body):
        root = body.get("root")
        return {"type": event_type, "root": root} if is_text(root) else None
    return build


POST_ROUTES = {
    "/ask": ask_event,
    "/publish": root_event("publish"),
    "/refresh": root_event("refresh"),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "intent"
    sys_version = ""
    timeout = 10  # seconds a silent client may hold a thread

    def log_message(self, format, *args):  # noqa: A002 - signature fixed by the base class
        pass

    # -- plumbing ---------------------------------------------------------

    def reply(self, status, body=b"", content_type=None, headers=None):
        self.send_response(status)
        if status not in (204, 304):
            self.send_header("Content-Length", str(len(body)))
            if content_type:
                self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if body and status not in (204, 304):
            self.wfile.write(body)

    def send_error(self, code, message=None, explain=None):
        """Malformed-request errors raised by the base class go through reply() too."""
        self.close_connection = True
        self.reply(code)

    def __getattr__(self, name):
        # Any verb without a handler of its own (HEAD, OPTIONS, PUT, ...) is refused, not 501.
        if name.startswith("do_"):
            return self.refuse_method
        raise AttributeError(name)

    def split_target(self):
        path, _, query = self.path.partition("?")
        return path, parse_qs(query.split("#", 1)[0]).get("t", [None])[0]

    def host_is_valid(self):
        return self.headers.get("Host") == self.server.host

    def token_is_valid(self, candidate):
        if not isinstance(candidate, str):
            return False
        return hmac.compare_digest(
            candidate.encode("utf-8", "surrogatepass"), self.server.token.encode("utf-8"))

    # -- verbs without a handler -----------------------------------------

    def refuse_method(self):
        _, token = self.split_target()
        if not self.host_is_valid() or not self.token_is_valid(token):
            return self.reply(403)
        self.close_connection = True
        self.reply(405, headers={"Allow": "GET, POST"})

    # -- GET --------------------------------------------------------------

    def do_GET(self):
        path, token = self.split_target()
        if not self.host_is_valid() or not self.token_is_valid(token):
            return self.reply(403)
        if path == "/ping":
            self.server.events.viewer()
            return self.reply(204)
        if path == "/" + REVIEW_FILE:
            return self.serve_review()
        route = PAGE_ROUTES.get(path)
        if route is None:
            return self.reply(404)
        name, content_type = route
        self.serve_file(os.path.join(self.server.page_dir, name), content_type)

    def serve_file(self, file_path, content_type, etag_from_stat=False):
        try:
            with open(file_path, "rb") as handle:
                stat = os.fstat(handle.fileno())
                data = handle.read()
        except OSError:
            return self.reply(404)
        headers = {}
        if etag_from_stat:
            etag = '"%d-%d"' % (stat.st_mtime_ns, stat.st_size)
            if self.headers.get("If-None-Match") == etag:
                return self.reply(304, headers={"ETag": etag})
            headers["ETag"] = etag
        self.reply(200, data, content_type, headers)

    def serve_review(self):
        self.serve_file(os.path.join(self.server.session_dir, REVIEW_FILE), JSON_TYPE, etag_from_stat=True)

    # -- POST -------------------------------------------------------------

    def body_length(self):
        """(length, None) for a usable Content-Length, else (None, status to answer)."""
        header = self.headers.get("Content-Length")
        if header is None:
            return None, 411
        if not (header.isascii() and header.isdigit()):
            return None, 400
        if len(header) > 9 or int(header) > MAX_BODY_BYTES:
            return None, 413
        return int(header), None

    def do_POST(self):
        path, query_token = self.split_target()
        if not self.host_is_valid() or self.headers.get("Origin") != self.server.origin:
            return self.reply(403)
        if query_token is not None and not self.token_is_valid(query_token):
            return self.reply(403)
        length, problem = self.body_length()
        if problem is not None:
            # Without a valid query token the body token cannot be read: that is a 403, not a 4xx hint.
            self.close_connection = True
            return self.reply(problem if query_token is not None else 403)
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, RecursionError):  # bad JSON, or nested too deep
            body = None
        if query_token is None:
            if not self.token_is_valid(body.get("t") if isinstance(body, dict) else None):
                return self.reply(403)
        build = POST_ROUTES.get(path)
        if build is None:
            return self.reply(404)
        event = build(body) if isinstance(body, dict) else None
        if event is None:
            return self.reply(400)
        if not self.server.events.emit(event):
            return self.reply(503)
        self.reply(200, b"{}", JSON_TYPE)


class ReviewServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port, session_dir, page_dir, token, events):
        ThreadingHTTPServer.__init__(self, ("127.0.0.1", port), Handler)
        self.session_dir = session_dir
        self.page_dir = page_dir
        self.token = token
        self.events = events
        self.host = "127.0.0.1:%d" % self.server_address[1]
        self.origin = "http://" + self.host


def bind(port, session_dir, page_dir, token, events):
    """Bind the requested port; when it is busy, let the OS pick a free one."""
    try:
        return ReviewServer(port, session_dir, page_dir, token, events)
    except OSError:
        if port == 0:
            raise
        return ReviewServer(0, session_dir, page_dir, token, events)


def watch_parent(parent, stop):
    """Claude Code gone without stopping the server (a crash, a force quit): with no page open nothing is
    written, so a dead stdout is never seen. A new parent pid means the old one is gone."""
    while True:
        time.sleep(PARENT_CHECK_SECONDS)
        if os.getppid() != parent:
            warn("parent is gone, stopping")
            stop()
            return


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Local review server for the intent mod.")
    parser.add_argument("--dir", required=True, help="session folder holding review.json")
    parser.add_argument("--page", required=True, help="folder holding the page files")
    parser.add_argument("--token", required=True, help="32 hexadecimal characters")
    parser.add_argument("--port", type=int, default=0, help="0 lets the OS choose")
    args = parser.parse_args(argv)
    if not TOKEN_PATTERN.fullmatch(args.token):
        parser.error("--token must be 32 lowercase hexadecimal characters")
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    return args


def detach_streams():
    """Point fds 1 and 2 at /dev/null so the interpreter's final flush cannot fail on a dead pipe."""
    try:
        devnull = os.open(os.devnull, os.O_WRONLY)
    except OSError:
        return
    try:
        for stream in (sys.stdout, sys.stderr):
            try:
                os.dup2(devnull, stream.fileno())
            except (OSError, ValueError):
                pass
    finally:
        os.close(devnull)


def main(argv):
    args = parse_args(argv)
    parent = os.getppid()
    holder = {}

    def stop(_signum=None, _frame=None):
        # shutdown() blocks until serve_forever() returns, so it cannot run in the calling thread.
        threading.Thread(target=holder["server"].shutdown, daemon=True).start()

    events = Events(sys.stdout.buffer, stop)
    server = holder["server"] = bind(args.port, args.dir, args.page, args.token, events)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    threading.Thread(target=watch_parent, args=(parent, stop), daemon=True).start()
    try:
        if events.emit({"type": "ready", "port": server.server_address[1]}):
            server.serve_forever()
    finally:
        server.server_close()
        detach_streams()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
