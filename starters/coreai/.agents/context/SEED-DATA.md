# CoreAI seed data

Use [the state-management skill](../skills/state-management/SKILL.md) for `app/data/`, query hooks and mock-data assembly. Keep raw mock records separate from derived query or presentation state. Preserve existing loading and failure behavior.

Use synthetic names, identifiers and records only. Do not commit real user information, customer data, credentials, prompts or responses. Add empty, populated and failure scenarios when the requested flow needs them, using the existing feature and variant system rather than a second configuration mechanism.

The example does not define a consuming team's domain model. Ask for task-blocking domain decisions; do not infer production permissions or retention from mock records.
