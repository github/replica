"""Load this directory as the replica_brand_check package, so tests run without installing it."""

import importlib.util
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent

if "replica_brand_check" not in sys.modules:
    _spec = importlib.util.spec_from_file_location(
        "replica_brand_check", _ROOT / "__init__.py", submodule_search_locations=[str(_ROOT)]
    )
    assert _spec is not None and _spec.loader is not None
    _package = importlib.util.module_from_spec(_spec)
    sys.modules["replica_brand_check"] = _package
    _spec.loader.exec_module(_package)
