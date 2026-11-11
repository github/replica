"""Serve the local Replica decision-model runtime over a small authenticated HTTP API."""

from __future__ import annotations

import argparse
import hmac
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .runtime import D1OmniBackend, FixtureBackend, LocalRuntime, RuntimeFailure

TOKEN_VARIABLE = "REPLICA_RUNTIME_TOKEN"
MIN_TOKEN_LENGTH = 32
MAX_REQUEST_BYTES = 180 * 1024 * 1024
_SAFE_TOKEN = re.compile(r"^[\x21-\x7e]+$")


def runtime_token(environ: dict[str, str]) -> str:
    """Return a strong runtime token without ever including it in an error."""
    token = environ.get(TOKEN_VARIABLE, "")
    if len(token) < MIN_TOKEN_LENGTH or not _SAFE_TOKEN.fullmatch(token):
        raise RuntimeFailure(
            "token_missing",
            f"Set {TOKEN_VARIABLE} to a random secret of at least {MIN_TOKEN_LENGTH} printable "
            "ASCII characters.",
        )
    return token


class RuntimeHTTPServer(ThreadingHTTPServer):
    """HTTP server carrying one local runtime and its bearer token."""

    daemon_threads = True

    def __init__(self, address: tuple[str, int], runtime: LocalRuntime, token: str):
        super().__init__(address, RuntimeHandler)
        self.runtime = runtime
        self.token = token.encode()


class RuntimeHandler(BaseHTTPRequestHandler):
    """Route runtime requests and return JSON errors with stable codes."""

    server: RuntimeHTTPServer
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        try:
            path = urlparse(self.path).path
            if path == "/health":
                self._send(200, {"status": "healthy"})
                return
            self._authorize()
            if path == "/v1/promotion":
                promotion = self.server.runtime.promotion(required=False)
                self._send(200, promotion or {"candidateId": None})
                return
            if path.startswith("/v1/jobs/"):
                self._send(200, self.server.runtime.job(path.removeprefix("/v1/jobs/")))
                return
            if path.startswith("/v1/candidates/"):
                self._send(
                    200, self.server.runtime.candidate(path.removeprefix("/v1/candidates/"))
                )
                return
            raise RuntimeFailure("not_found", f"Route {path} was not found.", 404)
        except RuntimeFailure as error:
            self._failure(error)
        except Exception as error:
            self._failure(RuntimeFailure("internal_error", str(error), 500))

    def do_POST(self) -> None:
        try:
            self._authorize()
            path = urlparse(self.path).path
            body = self._body()
            if path == "/v1/jobs":
                job = self.server.runtime.submit(
                    backend=body.get("backend", "fixture"),
                    max_updates=body.get("maxUpdates"),
                    max_seconds=body.get("maxSeconds"),
                )
                self._send(202, job)
                return
            if path == "/v1/promotions":
                self._send(
                    200,
                    self.server.runtime.promote(
                        body.get("candidateId"), promoted_by=body.get("promotedBy")
                    ),
                )
                return
            if path in ("/score", "/v1/evaluations"):
                self._send(200, self.server.runtime.evaluate(body))
                return
            raise RuntimeFailure("not_found", f"Route {path} was not found.", 404)
        except RuntimeFailure as error:
            self._failure(error)
        except Exception as error:
            self._failure(RuntimeFailure("internal_error", str(error), 500))

    def log_message(self, format: str, *args: Any) -> None:
        """Keep the default access log, which never includes Authorization header values."""
        super().log_message(format, *args)

    def _authorize(self) -> None:
        value = self.headers.get("Authorization", "")
        scheme, _, credentials = value.partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(
            credentials.strip().encode(), self.server.token
        ):
            raise RuntimeFailure(
                "unauthorized",
                f"Send {TOKEN_VARIABLE} in Authorization: Bearer <token>.",
                401,
            )

    def _body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            raise RuntimeFailure("invalid_input", "Content-Length must be an integer.")
        if not 0 < length <= MAX_REQUEST_BYTES:
            raise RuntimeFailure(
                "invalid_input", f"The JSON request must be from 1 to {MAX_REQUEST_BYTES} bytes."
            )
        try:
            value = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise RuntimeFailure("invalid_input", "The request body must be one JSON object.")
        if not isinstance(value, dict):
            raise RuntimeFailure("invalid_input", "The request body must be one JSON object.")
        return value

    def _failure(self, error: RuntimeFailure) -> None:
        headers = {"WWW-Authenticate": "Bearer"} if error.status == 401 else None
        self._send(error.status, {"error": {"code": error.code, "message": str(error)}}, headers)

    def _send(
        self, status: int, value: Any, headers: dict[str, str] | None = None
    ) -> None:
        data = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    """Run one runtime bound to one taskset and one durable state directory."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", required=True, type=Path, help="durable runtime state directory")
    parser.add_argument("--taskset", required=True, type=Path, help="read-only decision taskset")
    parser.add_argument("--host", default="127.0.0.1", help="address to listen on")
    parser.add_argument("--port", type=int, default=8010, help="port to listen on")
    parser.add_argument("--d1-model", type=Path, help="downloaded d1-omni-600M model directory")
    parser.add_argument(
        "--environment-url",
        default="http://127.0.0.1:8000",
        help="brand-check OpenEnv server used by d1 training",
    )
    args = parser.parse_args()
    token = runtime_token(dict(os.environ))
    os.environ.pop(TOKEN_VARIABLE, None)
    backends: dict[str, Any] = {"fixture": FixtureBackend()}
    if args.d1_model:
        backends["d1-omni"] = D1OmniBackend(
            args.d1_model, environment_url=args.environment_url
        )
    runtime = LocalRuntime(args.state, args.taskset, backends)
    server = RuntimeHTTPServer((args.host, args.port), runtime, token)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        runtime.close()


if __name__ == "__main__":
    main()
