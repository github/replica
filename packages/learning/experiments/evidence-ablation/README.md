# Learning evidence ablation

This local harness measures what Replica gains when it trains and evaluates the same learning loop with progressively richer evidence. It reads only the corpus path named in an experiment manifest. It never searches Copilot history, browser storage, Hub storage, or nearby directories.

The evidence tiers are cumulative:

- **A:** Raw prototype review comments and their saved review anchors.
- **B:** Tier A plus Build chronology, comment edits and replies, resolution and reopen events, changed Builds, and reviewer verification.
- **C:** Tier B plus authoring sessions that a person explicitly exported for this evaluation purpose.

Each prototype describes one underlying evolution. The adapters remove layers for A and B instead of inventing separate tier-specific worlds. The synthetic fixture follows Replica's current metadata: repository and prototype IDs, branch and start page, declared templates and routes, Build numbers and commit SHAs, desktop and narrow screenshots in light and dark themes, review anchors, replies, edits, deletion, resolution, reopen and resolved-again events, accepted-learning IDs, and explicit authoring actions.

## Run the no-GPU demonstration

The fixture backend ignores image pixels. It exercises the real decision taskset loader, proper-scoring evaluation, local runtime connectors, bounded job, immutable candidate, reward, calibration, and per-learning reports.

```sh
cd packages/learning
npm run experiment:evidence:demo -- --out /tmp/replica-evidence-ablation
```

Run a prepared manifest:

```sh
npm run experiment:evidence -- \
  --manifest /private/path/experiment.json \
  --out /private/path/results
```

The npm commands select an installed Python 3.10 or later. Set `REPLICA_PYTHON` when the supported interpreter has another name.

The default manifest uses the deterministic `fixture` backend. To run a real local model through the same runtime connectors, add `backendModule` to `runtime`. The path is relative to the experiment manifest and must name trusted Python code that exports `create_backends()`. That function returns the backend mapping accepted by `LocalRuntime`; `runtime.backend` selects one entry. The harness still uses the same tasksets, budgets, candidate store, and evaluation path.

The output directory contains private tier tasksets and runtime state plus `report.json` and `report.md`. The reports contain aggregate metrics and digested identifiers only.

## Input and privacy contract

The versioned contracts are under [`contracts/v1`](contracts/v1). The manifest must name one explicit corpus file. The corpus records:

- the purpose, consent record, allowed uses, retention owner, and deletion deadline;
- the repository scope and export time;
- the cumulative evidence layers;
- optional synthetic or blinded-human evaluation labels.

Comments, screenshots, prompts, traces, and identities are sensitive. Store them outside Git, use a private directory, and grant the evaluation purpose before exporting them. Redact secrets and replace display identities with stable pseudonyms before running the harness. The corpus owner must delete source exports, generated tasksets, runtime state, and reports when consent ends or the retention deadline arrives. Never commit real customer data.

The harness records corpus and manifest digests, verifies exact v1 fields, checks route and Build references, refuses deleted comments that retain text, checks cumulative tier references, and round-trips every generated taskset through the production loader. Reports never include raw content.

An `explicit-local-export` corpus must give every screenshot a path relative to the corpus file. The harness refuses absolute paths, traversal, symbolic-link escapes, unsupported media, duplicate renderings, and images larger than 25 MiB before it copies the named screenshots into each private taskset. Synthetic corpora use the committed one-pixel fixture only to exercise orchestration without customer content.

## Metrics

Automatic metrics include evidence yield and coverage, proposal precision/recall/F1 when evaluation labels exist, held-out guidance coverage, decision-model reward, calibration, per-learning balanced accuracy, regressions, update budget, and wall time. Fixture cost is zero and is labeled as fixture cost.

Human judgments remain required for proposal correctness, proposal usefulness, accepted-guidance usefulness, and the severity of representative wins or regressions. Real studies should use the blinded protocol below instead of treating automatic proxies as final evidence.

## Blinded human evaluation protocol

**Hypotheses**

1. Tier B produces more useful and correct proposals than Tier A because review outcomes distinguish a reported problem from a reviewer-verified fix.
2. Tier C improves usefulness beyond Tier B when authoring traces explain which guidance and actions caused a Build change.
3. Richer evidence must not reduce held-out decision reward or worsen calibration beyond a preregistered tolerance.

**Unit and assignment**

Split by prototype unless collaboration or shared repository guidance creates likely spillover; then split by repository. Keep every Build, thread, and session from one boundary in one split. Give raters shuffled proposal and guidance packets with the tier, source path, repository, prototype, actor, and timestamps hidden. Do not show the same underlying scenario from two tiers to one rater in the same sitting.

**Ratings**

For each proposal, ask two independent raters to score correctness, actionability, specificity, likely usefulness to a future author, and risk of causing a regression. Resolve disagreements through a third blinded rater. Record whether the judgment required information unavailable in the packet. Evaluate representative Build decisions separately from proposal prose.

**Minimum viable sample**

Use at least 30 independent prototype boundaries and 100 rated proposals across at least three repositories before making a directional product decision. Include at least 30 held-out Build-learning labels per tier for calibration. Treat smaller studies as pilot evidence and report wide uncertainty. A customer-specific claim needs that customer's data; a cross-customer claim needs multiple customers and repository types.

**Stopping criteria**

Use a fixed sample and analysis date. Stop early only for a privacy incident, data leakage, sample-ratio mismatch, corrupted split, or a preregistered severe regression threshold. Do not stop because one tier is temporarily ahead. Correct multiple tier comparisons, report confidence intervals, and retain neutral or negative results.

**Decision rule**

Prefer the smallest tier that clears the preregistered usefulness improvement, keeps reviewer agreement acceptable, improves or preserves held-out reward, and does not materially worsen calibration, privacy risk, or collection cost. Do not infer causality from one repository or one customer's conventions.

## First real study

Start with 30 to 50 prototypes from at least three consenting internal repositories. Export complete review collections and Build metadata, then ask a subset of authors to explicitly export relevant sessions for Tier C. Use prototype-level splits unless repository-level spillover is likely. Pre-register a 10% relative improvement in blinded usefulness as the minimum practical effect, no more than a 0.02 absolute calibration regression, and fixed-horizon analysis.

Use aggregate production statistics only to tune synthetic distributions: counts of comments per thread, reply depth, edit/deletion rates, resolution and reopen rates, Builds per prototype, routes per Build, screenshot completeness, and session action counts. Do not copy comment text, prompts, screenshots, identities, or repository names into fixtures.

## Product decision

Use A-to-B gains to decide whether future extraction should prioritize complete review lifecycle and Build-change linkage. Use B-to-C gains to decide whether explicit authoring-session export is worth its consent, retention, and collection cost. A synthetic win only proves that the harness can detect a designed difference; it does not justify product collection.
