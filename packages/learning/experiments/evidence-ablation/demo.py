#!/usr/bin/env python3
"""Run the deterministic no-GPU evidence ablation demonstration."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from evidence_ablation import ExperimentError, run_experiment  # noqa: E402
from generate_synthetic import main as generate_synthetic  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=HERE / ".demo-output")
    args = parser.parse_args()
    generate_synthetic()
    if args.out.exists():
        shutil.rmtree(args.out)
    try:
        report = run_experiment(HERE / "fixtures" / "synthetic" / "experiment.json", args.out)
    except ExperimentError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print((args.out / "report.md").read_text(encoding="utf-8"))
    print(f"JSON report: {args.out / 'report.json'}")
    print(f"Compared tiers: {', '.join(report['tiers'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
