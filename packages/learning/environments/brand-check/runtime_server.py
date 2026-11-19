"""Serve the local Replica decision-model runtime over a small authenticated HTTP API."""

from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import signal
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .connectors import RuntimeScope
from .d1_connector import D1OmniBackend, taskset_learning_texts
from .local_connectors import taskset_digest
from .runtime import ENVIRONMENTS, FixtureBackend, LocalRuntime, RuntimeFailure
from .taskset import load_taskset

TOKEN_VARIABLE = "REPLICA_RUNTIME_TOKEN"
MIN_TOKEN_LENGTH = 32
MAX_REQUEST_BYTES = 180 * 1024 * 1024
MAX_CONNECTIONS = 16
SOCKET_TIMEOUT_SECONDS = 10
_SAFE_TOKEN = re.compile(r"^[\x21-\x7e]+$")
_TASKSET_ROUTE = re.compile(r"^/v1/tasksets/([0-9a-f]{64})$")
_CANCEL_ROUTE = re.compile(r"^/v1/jobs/(job_[A-Za-z0-9]+)/cancel$")
_IDEMPOTENCY_KEY = re.compile(r"^[\x21-\x7e]{1,200}$")


def _stop(_signum: int, _frame: Any) -> None:
    raise KeyboardInterrupt


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

    daemon_threads = False

    def __init__(self, address: tuple[str, int], runtime: LocalRuntime, token: str):
        if len(token) < MIN_TOKEN_LENGTH or not _SAFE_TOKEN.fullmatch(token):
            raise RuntimeFailure("token_missing", "The runtime token is not valid.")
        super().__init__(address, RuntimeHandler)
        self.runtime = runtime
        self.token = token.encode()
        self._connections = threading.BoundedSemaphore(MAX_CONNECTIONS)

    def get_request(self) -> tuple[socket.socket, Any]:
        connection, address = super().get_request()
        connection.settimeout(SOCKET_TIMEOUT_SECONDS)
        return connection, address

    def process_request(self, request: socket.socket, client_address: Any) -> None:
        if not self._connections.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._connections.release()
            raise

    def process_request_thread(self, request: socket.socket, client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._connections.release()


class RuntimeHandler(BaseHTTPRequestHandler):
    """Route runtime requests and return JSON errors with stable codes."""

    server: RuntimeHTTPServer
    protocol_version = "HTTP/1.0"

    def setup(self) -> None:
        super().setup()
        self._header_timer = threading.Timer(
            SOCKET_TIMEOUT_SECONDS, self._close_slow_headers
        )
        self._header_timer.daemon = True
        self._header_timer.start()

    def parse_request(self) -> bool:
        try:
            return super().parse_request()
        finally:
            self._header_timer.cancel()

    def finish(self) -> None:
        self._header_timer.cancel()
        super().finish()

    def do_GET(self) -> None:
        try:
            path = urlparse(self.path).path
            if path == "/health":
                self._send(200, {"status": "healthy"})
                return
            if path == "/ready":
                try:
                    self.server.runtime.ready()
                except RuntimeFailure as error:
                    self._send(503, {"status": "not_ready", "reason": error.code})
                else:
                    self._send(200, {"status": "ready"})
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
            self.log_error("Unhandled runtime error: %r", error)
            self._failure(
                RuntimeFailure("internal_error", "The runtime failed unexpectedly.", 500)
            )

    def do_POST(self) -> None:
        try:
            self._authorize()
            path = urlparse(self.path).path
            body = self._body()
            cancellation = _CANCEL_ROUTE.fullmatch(path)
            if cancellation:
                if body:
                    raise RuntimeFailure(
                        "invalid_input", "Job cancellation accepts an empty JSON object."
                    )
                self._send(
                    200,
                    self.server.runtime.cancel(
                        cancellation.group(1),
                        idempotency_key=self._idempotency_key(
                            f"cancel:{cancellation.group(1)}"
                        ),
                    ),
                )
                return
            if path == "/v1/jobs":
                job = self.server.runtime.submit(
                    backend=body.get("backend", "fixture"),
                    max_updates=body.get("maxUpdates"),
                    max_seconds=body.get("maxSeconds"),
                    max_credits=body.get("maxCredits"),
                    budget_mode=body.get("budgetMode", "hard"),
                    taskset_digest=body.get("tasksetDigest"),
                )
                self._send(202, job)
                return
            if path == "/v1/promotions":
                self._send(
                    200,
                    self.server.runtime.promote(
                        body.get("candidateId"),
                        promoted_by=body.get("promotedBy"),
                        expected_generation=body.get("expectedGeneration"),
                        idempotency_key=self._idempotency_key(
                            "promote:"
                            f"{body.get('candidateId')}:{body.get('expectedGeneration')}"
                        ),
                    ),
                )
                return
            if path == "/v1/rollbacks":
                self._send(
                    200,
                    self.server.runtime.rollback(
                        rolled_back_by=body.get("rolledBackBy"),
                        expected_generation=body.get("expectedGeneration"),
                        idempotency_key=self._idempotency_key(
                            f"rollback:{body.get('expectedGeneration')}"
                        ),
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
            self.log_error("Unhandled runtime error: %r", error)
            self._failure(
                RuntimeFailure("internal_error", "The runtime failed unexpectedly.", 500)
            )

    def do_PUT(self) -> None:
        try:
            self._authorize()
            path = urlparse(self.path).path
            match = _TASKSET_ROUTE.fullmatch(path)
            if match is None:
                raise RuntimeFailure("not_found", f"Route {path} was not found.", 404)
            body = self._body()
            self._send(
                200,
                self.server.runtime.register_taskset(
                    match.group(1),
                    body,
                    idempotency_key=self._idempotency_key(
                        f"taskset:{match.group(1)}"
                    ),
                ),
            )
        except RuntimeFailure as error:
            self._failure(error)
        except Exception as error:
            self.log_error("Unhandled runtime error: %r", error)
            self._failure(
                RuntimeFailure("internal_error", "The runtime failed unexpectedly.", 500)
            )

    def log_message(self, format: str, *args: Any) -> None:
        """Keep the default access log, which never includes Authorization header values."""
        super().log_message(format, *args)

    def _close_slow_headers(self) -> None:
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

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

    def _idempotency_key(self, default: str) -> str:
        value = self.headers.get("Idempotency-Key", default)
        if not _IDEMPOTENCY_KEY.fullmatch(value):
            raise RuntimeFailure(
                "idempotency_key_invalid",
                "Idempotency-Key must contain 1 to 200 visible ASCII characters.",
            )
        return value

    def _failure(self, error: RuntimeFailure) -> None:
        self.close_connection = True
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
    parser.add_argument(
        "--taskset",
        type=Path,
        help="optional read-only default taskset; tasksets may also be uploaded through the API",
    )
    parser.add_argument("--host", default="127.0.0.1", help="address to listen on")
    parser.add_argument("--port", type=int, default=8010, help="port to listen on")
    parser.add_argument(
        "--tenant",
        default="local",
        help="customer tenant scope passed to every infrastructure connector",
    )
    parser.add_argument(
        "--repository",
        default="local/runtime",
        help="repository scope passed to every infrastructure connector",
    )
    parser.add_argument(
        "--environment",
        choices=ENVIRONMENTS,
        default="development",
        help="runtime environment; fixture candidates cannot be promoted in production",
    )
    parser.add_argument(
        "--d1-model",
        type=Path,
        help=(
            "reviewed local LiquidAI/d1-omni-600M directory at the pinned revision; "
            "omit for the fixture-only installation"
        ),
    )
    args = parser.parse_args()
    token = runtime_token(dict(os.environ))
    os.environ.pop(TOKEN_VARIABLE, None)
    backends: dict[str, Any] = {"fixture": FixtureBackend()}
    if args.d1_model is not None:
        taskset = load_taskset(args.taskset)
        backends["d1-omni"] = D1OmniBackend(
            args.d1_model,
            expected_taskset_digest=str(taskset_digest(taskset)),
            expected_learning_texts=taskset_learning_texts(taskset),
        )
    runtime = LocalRuntime(
        args.state,
        args.taskset,
        backends,
        environment=args.environment,
        scope=RuntimeScope(args.tenant, args.repository),
    )
    server = RuntimeHTTPServer((args.host, args.port), runtime, token)
    previous = signal.getsignal(signal.SIGTERM)
    signal.signal(signal.SIGTERM, _stop)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        runtime.close()
        signal.signal(signal.SIGTERM, previous)


if __name__ == "__main__":
    main()
