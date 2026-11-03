import contextlib
import io
import json
import subprocess
import unittest
from unittest.mock import MagicMock, patch

import deploy


IMAGE = "example.azurecr.io/hub@sha256:" + "a" * 64


class AzureScenario:
    def __init__(self, app_created=True, setup_status="Succeeded", lock_available=True):
        self.installation = {
            "name": "test-hub", "owner": "test-team", "subscription_id": "test-subscription",
            "resource_group": "test-hub", "app_name": "test-hub", "setup_job_name": "test-setup",
            "storage_account": "testhub", "release_container": "releases",
            "release_blob": "deployment.lock", "app_created": app_created,
            "url": "https://hub.example.com",
        }
        self.calls = []
        self.setup_status = setup_status
        self.lock_available = lock_available
        self.targeted = False
        self.replicas_read = 0

    def command(self, arguments, capture=False):
        self.calls.append(arguments)
        if arguments[0] == "terraform":
            operation = arguments[2]
            if operation == "output":
                return json.dumps(self.installation)
            if operation == "state":
                return "azurerm_container_app.hub[0]" if self.installation["app_created"] else ""
            if operation == "plan":
                self.targeted = any(item.startswith("-target=") for item in arguments)
            if operation == "show":
                return json.dumps({
                    "variables": {
                        "name": {"value": self.installation["name"]},
                        "subscription_id": {"value": self.installation["subscription_id"]},
                    },
                    "resource_changes": [],
                })
            if operation == "apply" and not self.targeted:
                self.installation["app_created"] = True
            return ""
        operation = arguments[1:4]
        if operation[:2] == ["account", "show"]:
            value = {"id": self.installation["subscription_id"]}
        elif operation[:2] == ["group", "show"]:
            value = {"tags": {
                "application": "replica-hub", "managed_by": "terraform",
                "installation": self.installation["name"], "owner": self.installation["owner"],
            }}
        elif operation == ["storage", "blob", "lease"]:
            if "acquire" in arguments:
                if not self.lock_available:
                    raise subprocess.CalledProcessError(1, arguments)
                value = "lease-id"
            else:
                value = None
        elif operation == ["containerapp", "revision", "list"]:
            value = [{"name": "old-revision", "properties": {"active": True}}]
        elif operation == ["containerapp", "replica", "list"]:
            self.replicas_read += 1
            value = [{"name": "old-replica"}] if self.replicas_read == 1 else []
        elif operation == ["containerapp", "job", "execution"]:
            value = [] if "list" in arguments else {"properties": {"status": self.setup_status}}
        elif operation == ["containerapp", "job", "start"]:
            value = {"name": "setup-execution"}
        elif operation[:2] == ["containerapp", "show"]:
            value = {"properties": {"latestRevisionName": "new", "latestReadyRevisionName": "new"}}
        elif operation[:2] == ["containerapp", "revision"]:
            value = None
        else:
            raise AssertionError(f"Unexpected Azure command: {arguments}")
        return json.dumps(value)

    def run(self, operation="release"):
        response = MagicMock()
        response.__enter__.return_value.status = 200
        with patch.object(deploy, "command", side_effect=self.command), \
                patch.object(deploy.time, "sleep"), \
                patch.object(deploy.urllib.request, "urlopen", return_value=response), \
                contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()):
            return deploy.main([
                operation, "--subscription", "test-subscription",
                "--backend", "backend.hcl", "--variables", "installation.tfvars",
                "--image", IMAGE, "--accept-maintenance",
            ])


class DeploymentTests(unittest.TestCase):
    def test_setup_failure_leaves_hub_stopped_and_retains_release_lock(self):
        scenario = AzureScenario(setup_status="Failed")
        self.assertEqual(scenario.run(), 1)
        self.assertTrue(any("deactivate" in call for call in scenario.calls))
        plans = [call for call in scenario.calls if call[0] == "terraform" and call[2] == "plan"]
        self.assertEqual(len(plans), 1)
        self.assertIn("-target=azurerm_container_app_job.setup", plans[0])
        self.assertFalse(any("activate" in call for call in scenario.calls))
        self.assertFalse(any("release" in call for call in scenario.calls))

    def test_release_waits_for_old_replicas_and_setup_before_rollout(self):
        scenario = AzureScenario()
        self.assertEqual(scenario.run(), 0)
        events = scenario.calls
        setup = next(index for index, call in enumerate(events) if call[1:4] == ["containerapp", "job", "start"])
        drained = [index for index, call in enumerate(events) if call[1:4] == ["containerapp", "replica", "list"]]
        rollout = next(index for index, call in enumerate(events)
                       if call[0] == "terraform" and call[2] == "plan" and "-var=deploy_hub=true" in call
                       and not any(item.startswith("-target=") for item in call))
        self.assertEqual(len(drained), 2)
        self.assertLess(max(drained), setup)
        self.assertLess(setup, rollout)
        self.assertTrue(any("release" in call for call in events))

    def test_initial_release_runs_setup_before_creating_the_app(self):
        scenario = AzureScenario(app_created=False)
        self.assertEqual(scenario.run(), 0)
        self.assertFalse(any("deactivate" in call for call in scenario.calls))
        plans = [call for call in scenario.calls if call[0] == "terraform" and call[2] == "plan"]
        self.assertIn("-var=deploy_hub=false", plans[0])
        self.assertIn("-var=deploy_hub=true", plans[1])

    def test_competing_release_cannot_stop_hub_or_run_setup(self):
        scenario = AzureScenario(lock_available=False)
        self.assertEqual(scenario.run(), 1)
        self.assertFalse(any("deactivate" in call for call in scenario.calls))
        self.assertFalse(any(call[1:4] == ["containerapp", "job", "start"] for call in scenario.calls))

    def test_bootstrap_refuses_an_existing_hub(self):
        scenario = AzureScenario()
        self.assertEqual(scenario.run("bootstrap"), 1)
        self.assertFalse(any(call[0] == "terraform" and call[2] == "apply" for call in scenario.calls))


if __name__ == "__main__":
    unittest.main()
