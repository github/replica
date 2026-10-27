# CoreAI Sandbox product context

## Scope

The included app is a Foundry-style sandbox for exploring agent and design-system experiences with local mock data. It is an example, not a production service or an authenticated product integration.

## Behavior and states

Preserve the existing navigation, settings, sample identity and route behavior unless the task changes them. Use local mock data for new example states. Register prototype features and variants in `app/features.json` through the [feature skill](../skills/features-variants/SKILL.md); do not add a second feature system.

Chat is a [local simulation](../../README.md#simulated-chat) that cycles through canned replies. Do not add API-key settings, live-model requests, real identities or production endpoints.

## Task decisions

The user's request defines the next flow and acceptance criteria. Preserve supplied references and agreed decisions. Ask about missing consequential behavior rather than inferring production permissions, persistence, destructive actions or team policy from this example.

## Limitations

No consuming team's users, domain rules, compliance requirements or production architecture are defined here. Use `/setup-skills` only when the user requests new reusable guidance or task-required context is missing, preserving existing app guidance and separate activation approval.
