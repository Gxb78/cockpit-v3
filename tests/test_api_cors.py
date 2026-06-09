import unittest

import app as mod


class FlaskApiCorsTests(unittest.TestCase):
    """The /api/ CORS policy reflects loopback origins only, never a wildcard."""

    def setUp(self):
        mod.app.config["TESTING"] = True
        self.client = mod.app.test_client()

    def _acao(self, origin):
        headers = {"Origin": origin} if origin is not None else {}
        # /api/health-style path: any /api/ route exercises the after_request hook.
        resp = self.client.get("/api/strategies", headers=headers)
        return resp.headers.get("Access-Control-Allow-Origin")

    def test_loopback_origin_is_reflected(self):
        for origin in ("http://localhost:5001", "http://127.0.0.1:5001", "https://localhost"):
            with self.subTest(origin=origin):
                self.assertEqual(self._acao(origin), origin)

    def test_cross_origin_gets_no_cors_header(self):
        for origin in ("https://evil.com", "http://example.org"):
            with self.subTest(origin=origin):
                self.assertIsNone(self._acao(origin))

    def test_localhost_prefix_spoof_rejected(self):
        # A prefix check would wrongly allow this; host match must reject it.
        self.assertIsNone(self._acao("http://localhost.attacker.com"))

    def test_no_origin_gets_no_wildcard(self):
        # Previously this returned "*"; now no CORS header at all.
        self.assertIsNone(self._acao(None))

    def test_vary_origin_set_when_reflected(self):
        resp = self.client.get("/api/strategies", headers={"Origin": "http://localhost:5001"})
        self.assertIn("Origin", resp.headers.get("Vary", ""))


if __name__ == "__main__":
    unittest.main()
