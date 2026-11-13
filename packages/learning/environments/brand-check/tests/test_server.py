import asyncio
import importlib
import importlib.util
import json
import os
import socket
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

from replica_brand_check.episode import Episodes
from replica_brand_check.taskset import load_taskset

from tests.support import RULE, make_task, write_taskset

TOKEN = "end-to-end-test-token-0123456789abcdef"


@unittest.skipUnless(importlib.util.find_spec("openenv"), "openenv-core is not installed")
class ServerTest(unittest.TestCase):
    def test_client_with_the_token_runs_an_episode_over_the_websocket(self):
        from openenv.core import GenericEnvClient
        from replica_brand_check import BrandCheckAction, BrandCheckEnv

        directory = write_taskset(self, [make_task(n, answer=False) for n in range(1, 4)])
        url = self.serve(directory)
        seeded_task = Episodes(load_taskset(directory)).reset(seed=5)["task_id"]
        answers = {RULE: {"probabilities": {"yes": 0.2, "no": 0.8}}}

        # serve() sets REPLICA_ENV_TOKEN, which the client sends by default.
        with BrandCheckEnv(base_url=url, message_timeout_s=10).sync() as env:
            result = env.reset(seed=5)
            self.assertEqual(result.observation.task_id, seeded_task)
            self.assertEqual(result.observation.labels, {})
            result = env.step(BrandCheckAction(answers=answers))
            self.assertTrue(result.done)
            self.assertAlmostEqual(result.reward, 0.96)
            self.assertEqual(result.observation.metadata["labels"], {RULE: False})
            with self.assertRaisesRegex(RuntimeError, "already done"):
                env.step(BrandCheckAction(answers=answers))

        # OpenEnv's own client sends no Authorization header, so the server refuses the handshake.
        with self.assertRaisesRegex(ConnectionError, "HTTP 403"):
            asyncio.run(GenericEnvClient(base_url=url).connect())
        empty_token = mock.patch.dict(os.environ, {"REPLICA_ENV_TOKEN": ""})
        with empty_token, self.assertRaisesRegex(ValueError, "REPLICA_ENV_TOKEN"):
            BrandCheckEnv(base_url=url)
        with urllib.request.urlopen(url + "/health", timeout=10) as response:
            self.assertEqual(json.load(response), {"status": "healthy"})

        # HTTP /step gets a new environment for every request, so it explains the WebSocket route.
        request = urllib.request.Request(
            url + "/step",
            data=json.dumps({"action": {"answers": answers}}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"},
        )
        with self.assertRaises(urllib.error.HTTPError) as refused:
            urllib.request.urlopen(request, timeout=10)
        self.assertEqual(refused.exception.code, 409)
        self.assertIn("WebSocket", json.load(refused.exception)["detail"])

    def serve(self, directory: Path) -> str:
        """Serve the real app, with TOKEN, on a free localhost port until the case ends."""
        import uvicorn

        environment = mock.patch.dict(
            os.environ, {"REPLICA_TASKSET_DIR": str(directory), "REPLICA_ENV_TOKEN": TOKEN}
        )
        environment.start()
        self.addCleanup(environment.stop)
        from replica_brand_check.server.brand_check_environment import shared_taskset

        shared_taskset.cache_clear()
        self.addCleanup(shared_taskset.cache_clear)
        name = "replica_brand_check.server.app"
        module = importlib.reload(sys.modules[name]) if name in sys.modules else None
        app = (module or importlib.import_module(name)).app

        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        self.addCleanup(listener.close)
        server = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 10)
        self.addCleanup(setattr, server, "should_exit", True)
        deadline = time.monotonic() + 30
        while not server.started:
            if not thread.is_alive() or time.monotonic() > deadline:
                self.fail("The server did not start.")
            time.sleep(0.05)
        return f"http://127.0.0.1:{listener.getsockname()[1]}"
