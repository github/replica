"""Require the server's shared secret token on every request except GET /health.

On a shared host, any local account can connect to the server's port. Any web page in the
operator's browser can open a WebSocket to it too, because browsers do not apply CORS to
WebSockets. Neither can read the token, and a page cannot add an Authorization header to a
WebSocket handshake. Requiring the token in that header keeps both away from the taskset.

This module uses only the standard library, so its tests run without OpenEnv.
"""

from __future__ import annotations

import hmac
import json
import string
from collections.abc import Awaitable, Callable, Mapping, MutableMapping
from typing import Any

TOKEN_VARIABLE = "REPLICA_ENV_TOKEN"
MIN_TOKEN_LENGTH = 32

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
App = Callable[[Scope, Receive, Send], Awaitable[None]]

# A token uses only characters that an Authorization header carries unchanged.
_TOKEN_CHARACTERS = frozenset(string.ascii_letters + string.digits + string.punctuation)
_REFUSAL = json.dumps(
    {
        "detail": (
            f"Send the server's token, the value of its {TOKEN_VARIABLE}, in the header "
            "Authorization: Bearer <token>."
        )
    }
).encode()


class TokenError(ValueError):
    """The token cannot protect the server. The message never includes the token."""


def server_token(environ: Mapping[str, str]) -> str:
    """Return the token in REPLICA_ENV_TOKEN, or raise TokenError when it is missing or weak."""
    token = environ.get(TOKEN_VARIABLE, "")
    if len(token) < MIN_TOKEN_LENGTH or not set(token) <= _TOKEN_CHARACTERS:
        raise TokenError(
            f"Set {TOKEN_VARIABLE} to a random secret of at least {MIN_TOKEN_LENGTH} letters, "
            "digits, or punctuation characters. One way to make one: "
            "python3 -c 'import secrets; print(secrets.token_urlsafe(32))'"
        )
    return token


class RequireToken:
    """ASGI middleware that passes on GET /health and requests that carry the token.

    It refuses an HTTP request without the token with status 401. It closes a WebSocket without
    the token before accepting it, so uvicorn refuses the handshake with status 403.
    """

    def __init__(self, app: App, token: str) -> None:
        self._app = app
        self._token = token.encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan" or _is_health_check(scope) or self._has_token(scope):
            await self._app(scope, receive, send)
        elif scope["type"] == "websocket":
            # 1008 is the WebSocket close code for a policy violation.
            await send({"type": "websocket.close", "code": 1008})
        else:
            await send(
                {
                    "type": "http.response.start",
                    "status": 401,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(_REFUSAL)).encode()),
                        (b"www-authenticate", b"Bearer"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": _REFUSAL})

    def _has_token(self, scope: Scope) -> bool:
        # Only the header counts. A token in the query string would appear in access logs.
        values: list[bytes] = [
            value for name, value in scope.get("headers", ()) if name.lower() == b"authorization"
        ]
        if len(values) != 1:
            return False
        scheme, _, credentials = values[0].strip().partition(b" ")
        return scheme.lower() == b"bearer" and hmac.compare_digest(credentials.strip(), self._token)


def _is_health_check(scope: Scope) -> bool:
    return (scope["type"], scope.get("method"), scope["path"]) == ("http", "GET", "/health")
