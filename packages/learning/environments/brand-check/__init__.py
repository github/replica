"""OpenEnv environment that scores probability answers about Replica Build screenshots."""

from importlib import import_module
from typing import Any

from .connector_conformance import ConnectorConformanceFixture, connector_conformance
from .taskset import question_options

__all__ = [
    "BrandCheckAction",
    "BrandCheckEnv",
    "BrandCheckObservation",
    "ConnectorConformanceFixture",
    "ConnectorError",
    "FixtureBackend",
    "LocalConnectorBundle",
    "LocalRuntime",
    "RuntimeConnectors",
    "RuntimeScope",
    "RuntimeFailure",
    "TasksetBundle",
    "TasksetImage",
    "TrainingResult",
    "connector_conformance",
    "create_local_connector_bundle",
    "question_options",
]

# The scoring modules use only the standard library. Importing the OpenEnv classes on first use
# lets them, and their tests, run where openenv-core is not installed.
_OPENENV_EXPORTS = {
    "BrandCheckAction": ".models",
    "BrandCheckObservation": ".models",
    "BrandCheckEnv": ".client",
    "ConnectorError": ".connectors",
    "FixtureBackend": ".runtime",
    "LocalConnectorBundle": ".local_connectors",
    "LocalRuntime": ".runtime",
    "RuntimeConnectors": ".connectors",
    "RuntimeScope": ".connectors",
    "TasksetBundle": ".connectors",
    "TasksetImage": ".connectors",
    "TrainingResult": ".connectors",
    "RuntimeFailure": ".runtime",
    "create_local_connector_bundle": ".local_connectors",
}


def __getattr__(name: str) -> Any:
    module = _OPENENV_EXPORTS.get(name)
    if module is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    return getattr(import_module(module, __name__), name)
