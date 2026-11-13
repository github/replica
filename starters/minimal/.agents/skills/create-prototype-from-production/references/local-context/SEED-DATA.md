# Seed data

> Minimal default context. Replace it through `/setup-skills` when your team has its own guidance.

## Scenario meaning and relationships

Use realistic, internally consistent records. Use synthetic values for anything customer-specific.

## Canonical inputs

Keep raw records in `src/data/`.

## Assembly and source reporting

Derive view models from raw records in loaders, not in presentation components. Render data as text; never evaluate it.

## Integrity and scenario checks

Add focused tests for meaningful relationships and interactions.
