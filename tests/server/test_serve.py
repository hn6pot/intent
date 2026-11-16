"""Tests of the local review server: launched as a subprocess, driven over HTTP,
its stdout (one JSON line per event) read back."""

import http.client
import json
import os
import queue
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import unittest

SERVE = os.path.join(os.path.dirname(__file__), "..", "..", "server", "serve.py")
TOKEN = "0123456789abcdef0123456789abcdef"
PAGE_FILES = {
    "index.html": "<!doctype html><title>stub page</title>é",
    "style.css": "body{color:red}",
    "app.js": "console.log('app')",
    "render.js": "console.log('render')",
    "answers.js": "export function answerHtml() {}",
    "escape.js": "export const escapeHtml = x => x",
    "texts.js": "export const TEXTS = {}",
    "select.js": "export function selectedLines() {}",
}


class Server(object):
    """One server subprocess plus a reader thread feeding its stdout lines to a queue."""

    def __init__(self, session_dir, page_dir, port=0, pump=True):
        self.proc = subprocess.Popen(
            ["/usr/bin/python3", SERVE, "--dir", session_dir, "--page", page_dir,
             "--token", TOKEN, "--port", str(port)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.lines = queue.Queue()
        if pump:
            threading.Thread(target=self._pump, daemon=True).start()
            ready = self.next_event()
        else:  # the test owns stdout (to close it)
            ready = json.loads(self.proc.stdout.readline().decode("utf-8"))
        self.port = ready["port"]
        self.ready = ready

    def _pump(self):
        for raw in self.proc.stdout:
            self.lines.put(raw.decode("utf-8"))

    def next_line(self, timeout=5):
        waited = 0.0
        while True:
            try:
                return self.lines.get(timeout=0.1)
            except queue.Empty:
                waited += 0.1
                if self.proc.poll() is not None and self.lines.empty():
                    raise AssertionError("server exited: %r" % self.proc.stderr.read())
                if waited >= timeout:
                    raise AssertionError("no line from the server within %ss" % timeout)

    def next_event(self, timeout=5):
        return json.loads(self.next_line(timeout))

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp, data

    def origin(self):
        return "http://127.0.0.1:%d" % self.port

    def post(self, path, payload, origin="default", token_in="body", raw=None):
        headers = {"Content-Type": "application/json"}
        if origin == "default":
            origin = self.origin()
        if origin is not None:
            headers["Origin"] = origin
        if token_in == "body":
            payload = dict(payload, t=TOKEN)
            url = path
        else:
            url = path + "?t=" + TOKEN
        body = raw if raw is not None else json.dumps(payload)
        return self.request("POST", url, body=body, headers=headers)

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
        self.proc.wait(timeout=5)
        if not self.proc.stdout.closed:
            self.proc.stdout.close()
        self.proc.stderr.close()


class ServeTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.session_dir = os.path.join(self.tmp, "session")
        self.page_dir = os.path.join(self.tmp, "page")
        os.mkdir(self.session_dir)
        os.mkdir(self.page_dir)
        for name, content in PAGE_FILES.items():
            with open(os.path.join(self.page_dir, name), "w", encoding="utf-8") as f:
                f.write(content)
        self.srv = Server(self.session_dir, self.page_dir)
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.addCleanup(self.srv.stop)

    def assert_next_event(self, expected):
        self.assertEqual(self.srv.next_event(), expected)

    def write_review(self, text):
        with open(os.path.join(self.session_dir, "review.json"), "w", encoding="utf-8") as f:
            f.write(text)


class TestStartup(ServeTestCase):
    def test_ready_reports_a_real_port(self):
        self.assertEqual(self.srv.ready["type"], "ready")
        self.assertGreater(self.srv.port, 0)

    def test_busy_port_falls_back_to_another_one(self):
        holder = socket.socket()
        holder.bind(("127.0.0.1", 0))
        holder.listen(1)
        self.addCleanup(holder.close)
        busy = holder.getsockname()[1]
        other = Server(self.session_dir, self.page_dir, port=busy)
        self.addCleanup(other.stop)
        self.assertEqual(other.ready["type"], "ready")
        self.assertNotEqual(other.port, busy)
        resp, _ = other.request("GET", "/?t=" + TOKEN)
        self.assertEqual(resp.status, 200)

    def test_stops_cleanly_on_sigterm(self):
        self.srv.proc.send_signal(signal.SIGTERM)
        self.assertEqual(self.srv.proc.wait(timeout=5), 0)

    def test_stops_cleanly_on_sigint(self):
        self.srv.proc.send_signal(signal.SIGINT)
        self.assertEqual(self.srv.proc.wait(timeout=5), 0)

    def test_rejects_a_malformed_token(self):
        proc = subprocess.run(
            ["/usr/bin/python3", SERVE, "--dir", self.session_dir, "--page", self.page_dir,
             "--token", "short", "--port", "0"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout, b"")


class TestGet(ServeTestCase):
    def test_every_route_refuses_a_missing_or_wrong_token(self):
        for path in ["/", "/style.css", "/app.js", "/render.js", "/answers.js", "/escape.js", "/texts.js", "/review.json", "/ping", "/nope"]:
            for query in ["", "?t=", "?t=" + "f" * 32, "?t=" + TOKEN[:-1], "?t=" + TOKEN + "0"]:
                resp, _ = self.srv.request("GET", path + query)
                self.assertEqual(resp.status, 403, path + query)

    def test_page_is_served_with_the_token(self):
        resp, body = self.srv.request("GET", "/?t=" + TOKEN)
        self.assertEqual(resp.status, 200)
        self.assertEqual(body.decode("utf-8"), PAGE_FILES["index.html"])
        self.assertEqual(resp.getheader("Content-Type"), "text/html; charset=utf-8")
        self.assertEqual(resp.getheader("Cache-Control"), "no-store")

    def test_static_files_have_the_right_content_types(self):
        expected = {
            "/style.css": "text/css; charset=utf-8",
            "/app.js": "text/javascript; charset=utf-8",
            "/render.js": "text/javascript; charset=utf-8",
            "/answers.js": "text/javascript; charset=utf-8",
            "/escape.js": "text/javascript; charset=utf-8",
            "/texts.js": "text/javascript; charset=utf-8",
            "/select.js": "text/javascript; charset=utf-8",
        }
        for path, content_type in expected.items():
            resp, body = self.srv.request("GET", path + "?t=" + TOKEN)
            self.assertEqual(resp.status, 200, path)
            self.assertEqual(resp.getheader("Content-Type"), content_type)
            self.assertEqual(resp.getheader("Cache-Control"), "no-store")
            self.assertEqual(body.decode("utf-8"), PAGE_FILES[path[1:]])

    def test_unknown_routes_and_traversal_attempts_are_404(self):
        for path in ["/nope", "/index.html", "/../server/serve.py", "/%2e%2e/%2e%2e/etc/passwd",
                     "/style.css/..", "//etc/passwd", "/review.json/x", "/ask", "/publish"]:
            resp, _ = self.srv.request("GET", path + "?t=" + TOKEN)
            self.assertEqual(resp.status, 404, path)
            self.assertEqual(resp.getheader("Cache-Control"), "no-store")

    def test_review_json_is_404_until_written(self):
        resp, _ = self.srv.request("GET", "/review.json?t=" + TOKEN)
        self.assertEqual(resp.status, 404)

    def test_review_json_has_an_etag_and_answers_304(self):
        self.write_review('{"generation": 1, "é": true}')
        resp, body = self.srv.request("GET", "/review.json?t=" + TOKEN)
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(body.decode("utf-8")), {"generation": 1, "é": True})
        self.assertEqual(resp.getheader("Content-Type"), "application/json; charset=utf-8")
        self.assertEqual(resp.getheader("Cache-Control"), "no-store")
        etag = resp.getheader("ETag")
        self.assertTrue(etag)
        resp, body = self.srv.request(
            "GET", "/review.json?t=" + TOKEN, headers={"If-None-Match": etag})
        self.assertEqual(resp.status, 304)
        self.assertEqual(body, b"")

    def test_review_json_etag_changes_when_the_file_changes(self):
        self.write_review('{"generation": 1}')
        first, _ = self.srv.request("GET", "/review.json?t=" + TOKEN)
        self.write_review('{"generation": 22}')
        resp, body = self.srv.request(
            "GET", "/review.json?t=" + TOKEN, headers={"If-None-Match": first.getheader("ETag")})
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(body), {"generation": 22})

    def test_nothing_is_written_to_stdout_by_refused_or_plain_gets(self):
        self.srv.request("GET", "/")
        self.srv.request("GET", "/?t=" + TOKEN)
        self.srv.request("GET", "/nope?t=" + TOKEN)
        resp, _ = self.srv.post("/refresh", {"root": "/r"})
        self.assertEqual(resp.status, 200)
        self.assert_next_event({"type": "refresh", "root": "/r"})


class TestPing(ServeTestCase):
    def test_ping_answers_204_and_is_rate_limited(self):
        for _ in range(3):
            resp, body = self.srv.request("GET", "/ping?t=" + TOKEN)
            self.assertEqual(resp.status, 204)
            self.assertEqual(body, b"")
            self.assertEqual(resp.getheader("Cache-Control"), "no-store")
        self.srv.post("/refresh", {"root": "/r"})
        self.assert_next_event({"type": "viewer"})
        self.assert_next_event({"type": "refresh", "root": "/r"})

    def test_refused_ping_emits_nothing(self):
        resp, _ = self.srv.request("GET", "/ping?t=wrong")
        self.assertEqual(resp.status, 403)
        self.srv.request("GET", "/ping?t=" + TOKEN)
        self.assert_next_event({"type": "viewer"})


class TestPost(ServeTestCase):
    ASK = {"kind": "here", "root": "/repo", "path": "src/a.ts", "hunk": "@@ -1 +1 @@\n-a\n+é", "text": "Pourquoi ?"}

    def test_ask_with_good_token_and_origin_emits_one_exact_line(self):
        resp, _ = self.srv.post("/ask", self.ASK)
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.getheader("Cache-Control"), "no-store")
        line = self.srv.next_line()
        self.assertTrue(line.endswith("\n"))
        self.assertIn("é", line)  # ensure_ascii=False
        self.assertEqual(json.loads(line), dict(self.ASK, type="ask"))

    def test_free_question_without_path_or_hunk(self):
        self.srv.post("/ask", {"kind": "free", "root": "/repo", "text": "Et la sécurité ?"})
        self.assert_next_event(
            {"type": "ask", "kind": "free", "root": "/repo", "path": None, "hunk": None,
             "text": "Et la sécurité ?"})

    SELECTION = {"kind": "selection", "root": "/repo", "path": "src/a.ts", "from": 3, "to": 5, "text": "const é = 1"}

    def test_selection_ask_emits_one_exact_line(self):
        resp, _ = self.srv.post("/ask", self.SELECTION)
        self.assertEqual(resp.status, 200)
        self.assert_next_event(dict(self.SELECTION, type="ask"))

    def test_bad_selection_is_400_and_silent(self):
        bad = [
            {"from": 6},
            {"from": 0, "to": 0},
            {"from": 2.5},
            {"from": "3"},
            {"from": True},
            {"to": None},
            {"path": ""},
            {"path": None},
            {"text": "x" * 5000},
            {"text": None},
        ]
        for change in bad:
            resp, _ = self.srv.post("/ask", dict(self.SELECTION, **change))
            self.assertEqual(resp.status, 400, json.dumps(change))
        resp, _ = self.srv.post("/ask", dict(self.SELECTION, text="x" * 4000))
        self.assertEqual(resp.status, 200)
        self.assertEqual(self.srv.next_event()["text"], "x" * 4000)

    def test_token_may_travel_in_the_query(self):
        resp, _ = self.srv.post("/ask", self.ASK, token_in="query")
        self.assertEqual(resp.status, 200)
        self.assert_next_event(dict(self.ASK, type="ask"))

    def test_publish_and_refresh(self):
        self.assertEqual(self.srv.post("/publish", {"root": "/repo"})[0].status, 200)
        self.assertEqual(self.srv.post("/refresh", {"root": "/repo"})[0].status, 200)
        self.assert_next_event({"type": "publish", "root": "/repo"})
        self.assert_next_event({"type": "refresh", "root": "/repo"})

    def test_wrong_or_missing_token_is_403_and_silent(self):
        headers = {"Origin": self.srv.origin(), "Content-Type": "application/json"}
        bodies = [
            ("/ask", json.dumps(dict(self.ASK, t="f" * 32))),
            ("/ask", json.dumps(self.ASK)),
            ("/ask?t=" + "f" * 32, json.dumps(self.ASK)),
            ("/ask", "not json at all"),
            ("/ask", json.dumps(dict(self.ASK, t=12345))),
            ("/ask", json.dumps(dict(self.ASK, t=[TOKEN]))),
        ]
        for url, body in bodies:
            resp, _ = self.srv.request("POST", url, body=body, headers=headers)
            self.assertEqual(resp.status, 403, url + body)
        self.srv.post("/refresh", {"root": "/r"})
        self.assert_next_event({"type": "refresh", "root": "/r"})

    def test_foreign_missing_or_lookalike_origin_is_403_and_silent(self):
        port = self.srv.port
        bad_origins = [
            "http://evil.example",
            "http://127.0.0.1:%d" % (port + 1),
            "http://localhost:%d" % port,
            "https://127.0.0.1:%d" % port,
            "http://127.0.0.1:%d/" % port,
            "http://127.0.0.1:%d.evil.example" % port,
            "null",
            "",
            None,
        ]
        for origin in bad_origins:
            resp, _ = self.srv.post("/ask", self.ASK, origin=origin)
            self.assertEqual(resp.status, 403, repr(origin))
            resp, _ = self.srv.post("/publish", {"root": "/r"}, origin=origin)
            self.assertEqual(resp.status, 403, repr(origin))
        self.srv.post("/refresh", {"root": "/r"})
        self.assert_next_event({"type": "refresh", "root": "/r"})

    def test_oversized_body_is_413_and_silent(self):
        big = json.dumps(dict(self.ASK, text="x" * 70 * 1024))
        self.assertGreater(len(big), 64 * 1024)
        resp, _ = self.srv.post("/ask", None, token_in="query", raw=big)
        self.assertEqual(resp.status, 413)
        self.srv.post("/refresh", {"root": "/r"})
        self.assert_next_event({"type": "refresh", "root": "/r"})

    def test_body_just_under_the_limit_is_accepted(self):
        payload = {"root": "/r", "pad": ""}
        overhead = len(json.dumps(dict(payload, t=TOKEN)))
        payload["pad"] = "x" * (64 * 1024 - overhead)
        resp, _ = self.srv.post("/refresh", payload)
        self.assertEqual(resp.status, 200)
        self.assert_next_event({"type": "refresh", "root": "/r"})

    def test_malformed_requests_are_400_and_silent(self):
        cases = [
            ("/ask", {"kind": "shout", "root": "/r", "text": "x"}),
            ("/ask", {"kind": "free", "root": "/r"}),
            ("/ask", {"kind": "free", "root": "/r", "text": 5}),
            ("/ask", {"kind": "here", "root": "/r", "path": 3, "hunk": "h", "text": "x"}),
            ("/ask", {"kind": "free", "text": "x"}),
            ("/publish", {}),
            ("/refresh", {"root": 7}),
        ]
        for path, payload in cases:
            resp, _ = self.srv.post(path, payload)
            self.assertEqual(resp.status, 400, path + json.dumps(payload))
        resp, _ = self.srv.post("/ask", None, raw='["a list"]', token_in="query")
        self.assertEqual(resp.status, 400)
        resp, _ = self.srv.post("/ask", None, raw="{broken", token_in="query")
        self.assertEqual(resp.status, 400)
        self.srv.post("/refresh", {"root": "/r"})
        self.assert_next_event({"type": "refresh", "root": "/r"})

    def test_unknown_post_route_is_404(self):
        resp, _ = self.srv.post("/nope", {"root": "/r"})
        self.assertEqual(resp.status, 404)
        resp, _ = self.srv.post("/review.json", {"root": "/r"})
        self.assertEqual(resp.status, 404)

    def test_post_without_content_length_is_refused(self):
        sock = socket.create_connection(("127.0.0.1", self.srv.port), timeout=5)
        sock.sendall(("POST /ask?t=%s HTTP/1.0\r\nHost: 127.0.0.1:%d\r\nOrigin: %s\r\n\r\n" % (TOKEN, self.srv.port, self.srv.origin())).encode())
        status = sock.recv(64).split(b"\r\n")[0]
        sock.close()
        self.assertIn(b" 411 ", status)


class TestHardening(ServeTestCase):
    def raw(self, request_bytes):
        """Send raw bytes on a fresh connection, return the status line and the lowercase headers."""
        sock = socket.create_connection(("127.0.0.1", self.srv.port), timeout=5)
        try:
            sock.sendall(request_bytes)
            data = b""
            while b"\r\n\r\n" not in data:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                data += chunk
        finally:
            sock.close()
        head = data.decode("latin-1").split("\r\n\r\n")[0].split("\r\n")
        return head[0], dict((h.split(":", 1)[0].lower(), h.split(":", 1)[1].strip()) for h in head[1:] if ":" in h)

    def raw_post(self, content_length, query_token=TOKEN, body=b"", origin=None, host=None):
        origin = origin or self.srv.origin()
        host = host or "127.0.0.1:%d" % self.srv.port
        target = "/ask" + ("?t=" + query_token if query_token else "")
        request = ("POST %s HTTP/1.0\r\nHost: %s\r\nOrigin: %s\r\n" % (target, host, origin)).encode()
        if content_length is not None:
            request += b"Content-Length: " + content_length.encode("latin-1") + b"\r\n"
        return self.raw(request + b"\r\n" + body)

    def assert_alive(self):
        resp, _ = self.srv.request("GET", "/ping?t=" + TOKEN)
        self.assertEqual(resp.status, 204)

    def test_other_verbs_are_403_without_a_token_and_405_with_one(self):
        for method in ["HEAD", "OPTIONS", "PUT", "DELETE", "PATCH", "TRACE"]:
            resp, _ = self.srv.request(method, "/?t=wrong", headers={"Origin": "http://evil.example"})
            self.assertEqual(resp.status, 403, method)
            resp, _ = self.srv.request(method, "/", headers={"Origin": "http://evil.example"})
            self.assertEqual(resp.status, 403, method)
            resp, _ = self.srv.request(method, "/?t=" + TOKEN)
            self.assertEqual(resp.status, 405, method)
            self.assertEqual(resp.getheader("Cache-Control"), "no-store")

    def test_preflight_from_a_foreign_origin_gets_no_cors_headers(self):
        resp, _ = self.srv.request("OPTIONS", "/ask", headers={
            "Origin": "http://evil.example", "Access-Control-Request-Method": "POST"})
        self.assertEqual(resp.status, 403)
        self.assertEqual(resp.getheader("Cache-Control"), "no-store")
        self.assertEqual([n for n, _ in resp.getheaders() if n.lower().startswith("access-control")], [])

    def test_wrong_host_is_403_on_every_verb(self):
        for method, path in [("GET", "/?t=" + TOKEN), ("GET", "/ping?t=" + TOKEN),
                             ("OPTIONS", "/?t=" + TOKEN)]:
            resp, _ = self.srv.request(method, path, headers={"Host": "evil.example"})
            self.assertEqual(resp.status, 403, method + path)
            resp, _ = self.srv.request(method, path, headers={"Host": "127.0.0.1:%d" % (self.srv.port + 1)})
            self.assertEqual(resp.status, 403, method + path)
        resp, _ = self.srv.post("/ask", {"kind": "free", "root": "/r", "text": "x"},
                                token_in="query")
        self.assertEqual(resp.status, 200)  # right Host (the client's default) still works
        self.assertEqual(self.raw_post("2", body=b"{}", host="evil.example")[0].split(" ")[1], "403")
        self.assert_next_event({"type": "ask", "kind": "free", "root": "/r", "path": None,
                                "hunk": None, "text": "x"})

    def test_post_without_a_valid_token_is_403_whatever_the_content_length(self):
        for content_length in [None, "abc", "\u00b2", "-1", "999999999999", "70000", "2"]:
            for query_token in [None, "f" * 32]:
                status, _ = self.raw_post(content_length, query_token=query_token, body=b"{}")
                self.assertEqual(status.split(" ")[1], "403", "%r %r" % (content_length, query_token))
        self.assert_alive()

    def test_non_ascii_digit_content_length_with_valid_token_is_400_and_server_survives(self):
        status, _ = self.raw_post("\u00b2", body=b"{}")
        self.assertEqual(status.split(" ")[1], "400")
        self.assert_alive()

    def test_huge_content_length_is_413(self):
        status, _ = self.raw_post("9" * 5000)
        self.assertEqual(status.split(" ")[1], "413")
        self.assert_alive()

    def test_lone_surrogates_never_reach_stdout_or_crash_the_server(self):
        headers = {"Origin": self.srv.origin(), "Content-Type": "application/json"}
        # surrogate as the body token: not the token -> 403
        resp, _ = self.srv.request("POST", "/ask", headers=headers,
                                   body='{"t": "\\ud800", "kind": "free", "root": "/r", "text": "x"}')
        self.assertEqual(resp.status, 403)
        # valid token, surrogate in the text / root / path -> 400
        for payload in ['{"kind": "free", "root": "/r", "text": "\\ud800"}',
                        '{"kind": "free", "root": "\\udfff", "text": "x"}',
                        '{"kind": "here", "root": "/r", "path": "\\ud800", "hunk": "h", "text": "x"}']:
            resp, _ = self.srv.request("POST", "/ask?t=" + TOKEN, headers=headers, body=payload)
            self.assertEqual(resp.status, 400, payload)
        resp, _ = self.srv.request("GET", "/?t=%ED%A0%80")
        self.assertEqual(resp.status, 403)
        self.assert_alive()
        self.assert_next_event({"type": "viewer"})

    def test_errors_raised_by_the_base_class_carry_no_store(self):
        many_headers = b"".join(b"X-%d: y\r\n" % n for n in range(150))
        status, headers = self.raw(b"GET / HTTP/1.0\r\n" + many_headers + b"\r\n")
        self.assertEqual(status.split(" ")[1], "431")
        self.assertEqual(headers.get("cache-control"), "no-store")
        self.assert_alive()

    def test_server_exits_on_its_own_when_stdout_is_gone(self):
        srv = Server(self.session_dir, self.page_dir, pump=False)
        self.addCleanup(srv.stop)
        srv.proc.stdout.close()
        resp, _ = srv.post("/refresh", {"root": "/r"})
        self.assertEqual(resp.status, 503)
        self.assertEqual(srv.proc.wait(timeout=5), 0)

    def test_server_exits_on_its_own_when_stdout_and_stderr_are_both_gone(self):
        srv = Server(self.session_dir, self.page_dir, pump=False)
        self.addCleanup(srv.stop)
        srv.proc.stdout.close()
        srv.proc.stderr.close()
        srv.post("/refresh", {"root": "/r"})
        self.assertEqual(srv.proc.wait(timeout=5), 0)

    def test_deeply_nested_json_is_400_and_server_survives(self):
        depth = 30000
        resp, _ = self.srv.post("/ask", None, token_in="query", raw="[" * depth + "]" * depth)
        self.assertEqual(resp.status, 400)
        resp, _ = self.srv.post("/ask", None, token_in="query", raw="[" * 65000)
        self.assertEqual(resp.status, 400)
        self.assert_alive()

    def test_sigterm_after_stdout_is_gone_still_exits_0(self):
        srv = Server(self.session_dir, self.page_dir, pump=False)
        self.addCleanup(srv.stop)
        srv.proc.stdout.close()
        srv.proc.send_signal(signal.SIGTERM)
        self.assertEqual(srv.proc.wait(timeout=5), 0)


def is_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


# Starts the server given in argv, waits for its ready line (its parent is known by then), prints its pid and exits.
LAUNCHER = (
    "import subprocess, sys\n"
    "p = subprocess.Popen(sys.argv[1:], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)\n"
    "p.stdout.readline()\n"
    "print(p.pid, flush=True)\n"
)


class TestOrphan(unittest.TestCase):
    def test_server_stops_on_its_own_when_its_parent_dies_without_stopping_it(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        launched = subprocess.run(
            ["/usr/bin/python3", "-c", LAUNCHER, "/usr/bin/python3", SERVE, "--dir", tmp, "--page", tmp, "--token", TOKEN],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10, check=True)
        pid = int(launched.stdout)
        deadline = time.monotonic() + 8
        while is_alive(pid) and time.monotonic() < deadline:
            time.sleep(0.1)
        if is_alive(pid):
            os.kill(pid, signal.SIGKILL)
            self.fail("the server outlived its parent")


if __name__ == "__main__":
    unittest.main()
