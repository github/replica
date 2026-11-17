"""WebSocket client that a trainer uses to reset and step the brand check environment."""

import math
import os
from typing import Any
from urllib.parse import urlsplit

from openenv.core import EnvClient
from openenv.core.client_types import StepResult
from openenv.core.env_server.types import State
from websockets.asyncio.client import ClientConnection
from websockets.asyncio.client import connect as ws_connect

from .access import TOKEN_VARIABLE
from .models import BrandCheckAction, BrandCheckObservation
from .taskset import MAX_IMAGE_BYTES, MAX_IMAGES

_RESULT_FIELDS = ("rewards", "invalid")
_LOOPBACK = {"localhost", "127.0.0.1", "::1"}

# The largest message the server sends: a task with every image at the size limit, each base64
# encoded in a data URL, plus room for the questions. OpenEnv's default of 100 is too small for it.
MAX_MESSAGE_MB = math.ceil(MAX_IMAGES * MAX_IMAGE_BYTES * 4 / 3 / 2**20) + 16


class BrandCheckEnv(EnvClient[BrandCheckAction, BrandCheckObservation, State]):
    """Client for one session of the brand check environment.

    Each client keeps one WebSocket connection, which the server pairs with its own episode. It
    sends the server's token in the Authorization header: the token argument, or
    REPLICA_ENV_TOKEN when token is None. Other keyword arguments go to OpenEnv's EnvClient, and
    max_message_size_mb defaults to MAX_MESSAGE_MB so the largest task the loader accepts fits.

    Example:
        >>> with BrandCheckEnv(
        ...     base_url="http://127.0.0.1:8000",
        ...     allow_insecure_loopback=True,
        ... ).sync() as env:
        ...     result = env.reset(split="train", seed=7)
        ...     result = env.step(BrandCheckAction(answers=answers))
        ...     print(result.reward, result.observation.rewards)
    """

    # OpenEnv 0.3.0 ships no type information, so this declares the connection that connect() sets.
    _ws: ClientConnection | None

    def __init__(
        self,
        base_url: str,
        token: str | None = None,
        allow_insecure_loopback: bool = False,
        **kwargs: Any,
    ) -> None:
        parsed = urlsplit(base_url)
        insecure_loopback = parsed.scheme == "http" and parsed.hostname in _LOOPBACK
        if parsed.scheme != "https" and not (insecure_loopback and allow_insecure_loopback):
            raise ValueError(
                "BrandCheckEnv requires https://. On a single-user machine only, pass "
                "allow_insecure_loopback=True to connect to an http:// loopback server."
            )
        token = os.environ.get(TOKEN_VARIABLE) if token is None else token
        if not token:
            raise ValueError(
                f"BrandCheckEnv needs the server's token: set {TOKEN_VARIABLE} or pass token."
            )
        super().__init__(base_url, **{"max_message_size_mb": MAX_MESSAGE_MB, **kwargs})
        self._token = token

    async def connect(self) -> "BrandCheckEnv":
        """Open the WebSocket connection with the token, or raise ConnectionError."""
        # Mirrors EnvClient.connect in OpenEnv 0.3.0, which sends no headers, to add the token.
        if self._ws is not None:
            return self

        try:
            self._ws = await ws_connect(
                self._ws_url,
                open_timeout=self._connect_timeout,
                max_size=self._max_message_size,
                additional_headers={"Authorization": f"Bearer {self._token}"},
                **({"proxy": None} if urlsplit(self._ws_url).hostname in _LOOPBACK else {}),
            )
        except Exception as error:
            raise ConnectionError(f"Failed to connect to {self._ws_url}: {error}") from error

        return self

    def _step_payload(self, action: BrandCheckAction) -> dict[str, Any]:
        return {"answers": action.answers}

    def _parse_result(self, payload: dict[str, Any]) -> StepResult[BrandCheckObservation]:
        fields = payload.get("observation", {})
        done = payload.get("done", False)
        # OpenEnv 0.3.0 leaves metadata off the wire, so rebuild it from the step result fields.
        metadata = {name: fields[name] for name in _RESULT_FIELDS} if done else {}
        observation = BrandCheckObservation(
            **fields, done=done, reward=payload.get("reward"), metadata=metadata
        )
        return StepResult(observation=observation, reward=payload.get("reward"), done=done)

    def _parse_state(self, payload: dict[str, Any]) -> State:
        return State(**payload)
