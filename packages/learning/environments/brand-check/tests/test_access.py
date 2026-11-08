import asyncio
import json
import unittest

from replica_brand_check.access import RequireToken, TokenError, server_token

TOKEN = "test-token-0123456789-abcdefghijklmnop"
BEARER = (b"authorization", b"Bearer " + TOKEN.encode())
WRONG_BEARER = (b"authorization", b"Bearer " + b"w" * len(TOKEN))


def http(path: str, *headers: tuple, method: str = "GET", query: bytes = b"") -> dict:
    return {
        "type": "http",
        "method": method,
        "path": path,
        "query_string": query,
        "headers": list(headers),
    }


def websocket(*headers: tuple) -> dict:
    return {"type": "websocket", "path": "/ws", "query_string": b"", "headers": list(headers)}


def call(scope: dict) -> tuple:
    """Pass one request through RequireToken. Return the scopes the app got and the messages."""
    reached = []
    sent = []

    async def app(scope, receive, send):
        reached.append(scope)

    async def receive():
        return {"type": "websocket.connect" if scope["type"] == "websocket" else "http.request"}

    async def send(message):
        sent.append(message)

    asyncio.run(RequireToken(app, TOKEN)(scope, receive, send))
    return reached, sent


class RequireTokenTest(unittest.TestCase):
    def test_health_check_needs_no_token(self):
        scope = http("/health")

        reached, sent = call(scope)

        self.assertEqual(reached, [scope])
        self.assertEqual(sent, [])

    def test_refuses_an_http_request_without_the_right_token(self):
        cases = {
            "no token": http("/schema"),
            "wrong token": http("/reset", WRONG_BEARER, method="POST"),
            "token in the query string": http("/schema", query=b"token=" + TOKEN.encode()),
        }
        for name, scope in cases.items():
            with self.subTest(name):
                reached, sent = call(scope)

                self.assertEqual(reached, [])
                start, body = sent
                self.assertEqual(start["status"], 401)
                self.assertIn((b"www-authenticate", b"Bearer"), start["headers"])
                self.assertIn((b"content-type", b"application/json"), start["headers"])
                self.assertTrue(json.loads(body["body"])["detail"])

    def test_passes_an_http_request_with_the_token(self):
        scope = http("/schema", BEARER)

        reached, sent = call(scope)

        self.assertEqual(reached, [scope])
        self.assertEqual(sent, [])

    def test_closes_a_websocket_without_the_token_before_accepting_it(self):
        reached, sent = call(websocket())

        self.assertEqual(reached, [])
        self.assertEqual(sent, [{"type": "websocket.close", "code": 1008}])

    def test_passes_a_websocket_with_the_token(self):
        scope = websocket(BEARER)

        reached, sent = call(scope)

        self.assertEqual(reached, [scope])
        self.assertEqual(sent, [])


class ServerTokenTest(unittest.TestCase):
    def test_refuses_a_missing_or_weak_token_without_revealing_it(self):
        cases = {
            "missing": {},
            "31 characters": {"REPLICA_ENV_TOKEN": "s" * 31},
            "spaces": {"REPLICA_ENV_TOKEN": "a passphrase with spaces that is long enough"},
        }
        for name, environ in cases.items():
            with self.subTest(name):
                with self.assertRaisesRegex(TokenError, "REPLICA_ENV_TOKEN") as refused:
                    server_token(environ)

                for token in environ.values():
                    self.assertNotIn(token, str(refused.exception))

        self.assertEqual(server_token({"REPLICA_ENV_TOKEN": TOKEN}), TOKEN)
