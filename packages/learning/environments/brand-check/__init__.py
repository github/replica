"""OpenEnv environment that scores probability answers about Replica Build screenshots."""

from importlib import import_module
from typing import Any

from .taskset import question_options

__all__ = [
    "BrandCheckAction",
    "BrandCheckEnv",
    "BrandCheckObservation",
    "ConnectorConformanceFixture",
    "ConnectorError",
    "FixtureBackend",
    "LocalRuntime",
    "RuntimeConnectors",
    "RuntimeScope",
    "RuntimeFailure",
    "TrainingResult",
    "connector_conformance",
    "question_options",
]

# The scoring modules use only the standard library. Importing the OpenEnv classes on first use
# lets them, and their tests, run where openenv-core is not installed.
_OPENENV_EXPORTS = {
    "BrandCheckAction": ".models",
    "BrandCheckObservation": ".models",
    "BrandCheckEnv": ".client",
    "ConnectorConformanceFixture": ".connector_conformance",
    "connector_conformance": ".connector_conformance",
    "ConnectorError": ".connectors",
    "FixtureBackend": ".runtime",
    "LocalRuntime": ".runtime",
    "RuntimeConnectors": ".connectors",
    "RuntimeScope": ".connectors",
    "TrainingResult": ".connectors",
    "RuntimeFailure": ".runtime",
}


def __getattr__(name: str) -> Any:
    module = _OPENENV_EXPORTS.get(name)
    if module is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    return getattr(import_module(module, __name__), name)
