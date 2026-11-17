"""Serve the brand check environment with OpenEnv's HTTP and WebSocket server.

Trainers use the WebSocket endpoint, /ws, through BrandCheckEnv. In OpenEnv 0.3.0, HTTP /reset
and /step create a new environment for every request, so HTTP /step never has an open episode.
Every route except GET /health needs the token in REPLICA_ENV_TOKEN.

    uvicorn replica_brand_check.server.app:app --host 0.0.0.0 --port 8000
"""

import argparse
import os

import uvicorn
from fastapi import Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from openenv.core.env_server.http_server import create_app

from ..access import RequireToken, server_token
from ..episode import EpisodeError, ResetError
from ..models import BrandCheckAction, BrandCheckObservation
from .brand_check_environment import BrandCheckEnvironment, shared_taskset

# A reset can hold five 25 MiB images, their base64 text, and the JSON message, about 460 MiB at
# worst, so four sessions fit in the 2 GiB that openenv.yaml declares.
MAX_SESSIONS = 4

# Check the token and the taskset before serving, so a missing token or a bad taskset stops
# startup instead of the first session.
_token = server_token(os.environ)
shared_taskset()

openenv_app = create_app(
    BrandCheckEnvironment,
    BrandCheckAction,
    BrandCheckObservation,
    env_name="brand_check",
    max_concurrent_envs=MAX_SESSIONS,
)


async def _refuse_reset(request: Request, error: Exception) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(error)})


async def _refuse_step(request: Request, error: Exception) -> JSONResponse:
    detail = (
        f"{error} HTTP /step creates a new environment for every request, so reset and step "
        "through the WebSocket client instead."
    )
    return JSONResponse(status_code=409, content={"detail": detail})


async def _ignore_closed_client(websocket: WebSocket, error: WebSocketDisconnect) -> None:
    return None


# OpenEnv's HTTP routes would turn these errors into a bare 500 without their messages.
openenv_app.add_exception_handler(ResetError, _refuse_reset)
openenv_app.add_exception_handler(EpisodeError, _refuse_step)
# After a session ends, OpenEnv 0.3.0 closes the WebSocket and logs a traceback when the client
# has already closed it. Nothing is left to clean up then; later OpenEnv releases ignore it too.
openenv_app.add_exception_handler(WebSocketDisconnect, _ignore_closed_client)

# Other accounts on the host, and web pages in the operator's browser, can reach the port, so
# every route except GET /health needs the token.
app = RequireToken(openenv_app, _token)


def main() -> None:
    """Run the server on 127.0.0.1 unless --host names another address, to keep data private."""
    parser = argparse.ArgumentParser(description="Serve the brand check environment.")
    parser.add_argument("--host", default="127.0.0.1", help="address to listen on")
    parser.add_argument("--port", type=int, default=8000, help="port to listen on")
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
