#!/usr/bin/env python3
"""Provision once, then release Hub with an explicit maintenance window."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from uuid import uuid4


ROOT = Path(__file__).resolve().parent
TERMINAL_EXECUTIONS = {"Succeeded", "Failed", "Stopped", "Canceled"}


def command(arguments, capture=False):
    result = subprocess.run(arguments, check=True, text=True, capture_output=capture)
    return result.stdout.strip() if capture else None


class Deployment:
    def __init__(self, arguments):
        self.args = arguments
        self.installation = None
        self.lease = None
        self.plan_path = ROOT / ".terraform" / f"deployment-{uuid4().hex}.tfplan"

    def terraform(self, *arguments, capture=False):
        return command(["terraform", f"-chdir={ROOT}", *arguments], capture=capture)

    def azure(self, *arguments):
        return json.loads(command([
            "az", *arguments, "--subscription", self.args.subscription,
            "--only-show-errors", "--output", "json",
        ], capture=True) or "null")

    def app_arguments(self):
        return ["--name", self.installation["app_name"],
                "--resource-group", self.installation["resource_group"]]

    def job_arguments(self):
        return ["--name", self.installation["setup_job_name"],
                "--resource-group", self.installation["resource_group"]]

    def blob_arguments(self, lease=True):
        return ["--account-name", self.installation["storage_account"],
                "--container-name", self.installation["release_container"],
                "--blob-name" if lease else "--name", self.installation["release_blob"],
                "--auth-mode", "login"]

    def read_installation(self):
        self.installation = json.loads(self.terraform("output", "-json", "installation", capture=True))
        if self.installation["subscription_id"] != self.args.subscription:
            raise RuntimeError("The selected subscription does not match this Terraform state.")

    def verify_ownership(self):
        group = self.azure("group", "show", "--name", self.installation["resource_group"])
        expected = {
            "application": "replica-hub", "managed_by": "terraform",
            "installation": self.installation["name"], "owner": self.installation["owner"],
        }
        if any(group.get("tags", {}).get(key) != value for key, value in expected.items()):
            raise RuntimeError("Resource group ownership does not match this installation.")

    def acquire_lock(self):
        self.lease = self.azure("storage", "blob", "lease", "acquire", *self.blob_arguments(),
                                "--lease-duration", "-1")
        if not isinstance(self.lease, str) or not self.lease:
            raise RuntimeError("Azure did not return a release lease ID.")

    def release_lock(self):
        self.azure("storage", "blob", "lease", "release", *self.blob_arguments(),
                   "--lease-id", self.lease)
        self.lease = None

    def plan(self, deploy_hub, target=None, destroy=False):
        arguments = [
            "plan", "-input=false", "-lock-timeout=60s",
            f"-var-file={self.args.variables}", f"-var=image={self.args.image}",
            f"-var=deploy_hub={str(deploy_hub).lower()}", f"-out={self.plan_path}",
        ]
        if target:
            arguments.append(f"-target={target}")
        if destroy:
            arguments.append("-destroy")
        self.terraform(*arguments)
        plan = json.loads(self.terraform("show", "-json", str(self.plan_path), capture=True))
        if not destroy:
            changes = plan.get("resource_changes", [])
            if any("delete" in change["change"]["actions"] for change in changes):
                raise RuntimeError("Release plans cannot delete or replace resources. Review recovery separately.")
            variables = plan["variables"]
            if variables["subscription_id"]["value"] != self.args.subscription:
                raise RuntimeError("The variable file selects a different subscription.")
            if self.installation and variables["name"]["value"] != self.installation["name"]:
                raise RuntimeError("The variable file selects a different installation.")

    def apply(self):
        self.terraform("apply", "-input=false", "-lock-timeout=60s", str(self.plan_path))

    def stop_hub(self):
        if not self.installation["app_created"]:
            return
        revisions = self.azure("containerapp", "revision", "list", *self.app_arguments())
        # Inspect every revision: an inactive revision may still be terminating.
        for revision in revisions:
            if revision["properties"]["active"]:
                self.azure("containerapp", "revision", "deactivate", *self.app_arguments(),
                           "--revision", revision["name"])
        deadline = time.monotonic() + 300
        for revision in revisions:
            while self.azure("containerapp", "replica", "list", *self.app_arguments(),
                             "--revision", revision["name"]):
                if time.monotonic() >= deadline:
                    raise RuntimeError("Old replicas have not stopped. Hub remains in maintenance.")
                time.sleep(5)

    def ensure_no_setup(self):
        executions = self.azure("containerapp", "job", "execution", "list", *self.job_arguments())
        if any(item["properties"]["status"] not in TERMINAL_EXECUTIONS for item in executions):
            raise RuntimeError("A setup execution is still running; do not start another release.")

    def setup(self):
        execution = self.azure("containerapp", "job", "start", *self.job_arguments())
        deadline = time.monotonic() + 1920
        while time.monotonic() < deadline:
            result = self.azure("containerapp", "job", "execution", "show",
                                *self.job_arguments(), "--job-execution-name", execution["name"])
            status = result["properties"]["status"]
            if status == "Succeeded":
                return
            if status in TERMINAL_EXECUTIONS:
                raise RuntimeError("Setup failed. Hub remains stopped; inspect the setup execution.")
            time.sleep(5)
        raise RuntimeError("Setup timed out. Check or stop the execution before releasing the lock.")

    def wait_ready(self):
        self.read_installation()
        app = self.azure("containerapp", "show", *self.app_arguments())
        revision = app["properties"]["latestRevisionName"]
        self.azure("containerapp", "revision", "activate", *self.app_arguments(),
                   "--revision", revision)
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            app = self.azure("containerapp", "show", *self.app_arguments())
            properties = app["properties"]
            if properties.get("latestReadyRevisionName") == revision:
                try:
                    with urllib.request.urlopen(self.installation["url"] + "/api/ready", timeout=10) as response:
                        if response.status == 200:
                            return
                except (urllib.error.URLError, TimeoutError):
                    pass
            time.sleep(5)
        raise RuntimeError("Hub did not become ready. Keep the release lock and investigate.")

    def run(self):
        self.terraform("init", "-input=false", f"-backend-config={self.args.backend}")
        account = self.azure("account", "show")
        if account["id"] != self.args.subscription:
            raise RuntimeError("Azure returned a different subscription.")
        if self.args.operation == "bootstrap":
            resources = self.terraform("state", "list", capture=True).splitlines()
            if resources:
                raise RuntimeError("Infrastructure already exists. Use release; review partial bootstrap recovery separately.")
            self.plan(False)
            self.apply()
            print("Infrastructure is ready. Hub is not running. Run release to apply setup first.")
            return

        self.read_installation()
        self.verify_ownership()
        if self.args.operation == "destroy" and self.args.confirm != self.installation["name"]:
            raise RuntimeError("Destroy requires --confirm with the exact installation name.")
        self.acquire_lock()
        self.read_installation()
        self.verify_ownership()
        self.ensure_no_setup()
        self.stop_hub()
        if self.args.operation == "destroy":
            self.plan(self.installation["app_created"], destroy=True)
            # Deleting our leased lock blob prevents new releases while Terraform destroys its container.
            self.azure("storage", "blob", "delete", *self.blob_arguments(lease=False), "--lease-id", self.lease)
            self.lease = None
            self.apply()
            print("Terraform-tracked installation resources were destroyed.")
            return

        # The target deliberately excludes the app until the complete setup sequence succeeds.
        self.plan(self.installation["app_created"], target="azurerm_container_app_job.setup")
        self.apply()
        self.setup()
        self.plan(True)
        self.apply()
        self.wait_ready()
        self.release_lock()
        print("Hub is ready. The maintenance window is complete.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["bootstrap", "release", "destroy"])
    parser.add_argument("--subscription", required=True)
    parser.add_argument("--backend", type=lambda value: str(Path(value).resolve()), required=True)
    parser.add_argument("--variables", type=lambda value: str(Path(value).resolve()), required=True)
    parser.add_argument("--image", required=True, help="Existing registry/repository@sha256:digest")
    parser.add_argument("--accept-maintenance", action="store_true")
    parser.add_argument("--confirm", help="Exact installation name; required for destruction")
    arguments = parser.parse_args(argv)
    if not re.fullmatch(r"[a-z0-9][a-z0-9.:/-]+@sha256:[a-f0-9]{64}", arguments.image):
        parser.error("--image must name an immutable SHA-256 digest.")
    if arguments.operation != "bootstrap" and not arguments.accept_maintenance:
        parser.error("Releases and destruction stop Hub. Supply --accept-maintenance.")
    os.umask(0o077)
    deployment = Deployment(arguments)
    try:
        deployment.run()
    except (RuntimeError, subprocess.CalledProcessError, KeyboardInterrupt) as error:
        print(f"Deployment stopped: {error}", file=sys.stderr)
        if deployment.lease:
            print("The infinite release lease is retained. Verify all processes and setup executions "
                  "have stopped before an operator breaks the lease.", file=sys.stderr)
        return 1
    finally:
        deployment.plan_path.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
