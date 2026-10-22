# CoreAI Sandbox product context

## Scope

The included app is a Foundry-style sandbox for exploring agent and design-system experiences with local mock data. It is an example, not a production service or an authenticated product integration.

## Behavior and states

Preserve the existing navigation, settings, sample identity and route behavior unless the task changes them. Use local mock data for new example states. Register prototype features and variants in `app/features.json` through the [feature skill](../skills/features-variants/SKILL.md); do not add a second feature system.

The app must work without Azure OpenAI. Any browser-to-Azure connection remains user-configured and optional. Follow the [credential and request boundaries](../../README.md#optional-azure-openai-connection); do not introduce real identities, production endpoints or automatic requests.

## Task decisions

The user's request defines the next flow and acceptance criteria. Preserve supplied references and agreed decisions. Ask about missing consequential behavior rather than inferring production permissions, persistence, destructive actions or team policy from this example.

## Limitations

No consuming team's users, domain rules, compliance requirements or production architecture are defined here. Use `/setup-skills` only when the user requests new reusable guidance or task-required context is missing, preserving existing app guidance and separate activation approval.
