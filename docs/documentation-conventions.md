# Documentation conventions

Write for the next contributor or operator making a decision. Lead with the rule or outcome, then give only the constraints and commands they need.

These conventions apply across Replica, including documentation, pull request descriptions, user-facing copy, and code comments. For example, explain that someone can restore a previous prototype before introducing the name of its storage mechanism.

## Working discussions

- Lead with the outcome.
- Use concise, plain language.
- Give only the reasoning needed for the current decision.
- Avoid repeating known context.
- Ask one focused question when the answer changes product behavior or prevents costly rework.

### Answer the current question

For a specific design question, recommend an option and explain its benefits and costs. Ask a question only when the answer would change the decision. Save function lists and other implementation details for implementation discussions.

For example, write: “Send live comment updates only to people who still have access. After reconnecting, load the current comments instead of replaying missed updates. This avoids storing a separate notification history.”

## Plain language

- Name the person or system performing the action.
- State the input and result.
- Explain the purpose before the mechanism.
- Introduce a concept before using its name in a diagram or rule.
- Keep one main idea in each sentence.
- Explain necessary technical terms once.
- Replace vague verbs such as "handle" or "manage" with the real action.
- Delete prose that repeats nearby code, a table, or another guide.
- Delete facts that do not help the reader make a decision or complete a task.
- Break long comma-separated lists into bullets.
- Use repository-relative links.
- Keep each paragraph and list item on one Markdown line. Do not wrap prose to a fixed column.

Prefer concrete wording:

| Instead of                      | Write                                                          |
| ------------------------------- | -------------------------------------------------------------- |
| `Validate workflow identity.`   | `Check the repository, branch, and commit reported by GitHub.` |
| `Hub owns comment data.`        | `Hub stores comments and displays review controls.`            |
| `Build output path is invalid.` | `Build output path exceeds the maximum depth of 20.`           |

## Product and design discussions

Before discussing implementation, agree on the feature requirements:

1. Name the person or system using the feature.
2. State the outcome they need.
3. State what they may view or change.
4. Explain how access or state begins and ends.
5. Name the first version's non-goals.

Once these requirements are agreed upon, keep following them without listing them in every reply. Answer the current question without adding unrelated requirements. Explain access rules, failures, and recovery when they affect the decision.

Label accepted requirements and proposed implementation choices separately. Do not present one possible mechanism as technically necessary. When a security boundary has several valid designs, explain the risk being controlled and why the proposed boundary is the simplest fit.

Use the accepted product name consistently. Remove rejected terminology and plans instead of leaving contradictory guidance in the same document.

## Guide shape

Use only the sections that help the reader, usually in this order:

```text
Purpose -> current status -> contract -> flow -> rules -> recovery -> operations
```

Document only current behavior. Use one main guide for each boundary. Overview and security docs should summarize and link instead of copying its details. Update the main guide when its rules change.

Refer to dependency manifests, runtime configuration, and release metadata instead of repeating software version numbers. Preserve required schema values, protocol identifiers, standards references, and attribution. Describe Replica as open source today; distinguish installation paths by their tools and source, not by internal or external audiences.

Use:

- A small diagram for a system boundary or sequence.
- A table for states, limits, or comparisons.
- A list for independent rules.
- Prose only when the connection between ideas matters.

Keep diagrams moving in one direction and label their start and result. A diagram should make sense without translating implementation jargon. Do not add a diagram when one sentence is clearer.

Product guides explain what people can do and see. Leave internal fields and thresholds in code or tests unless a contributor or operator needs them. Never include secrets, tokens, private keys, or real private repository data.

## Final review

Collect every changed Markdown file and code comment:

```sh
hub/bin/review-prose
```

Run this command from the repository root to include every project. From `hub/`, use `bin/review-prose` to review only Hub changes. Pass a Git base when reviewing committed work, for example `origin/main`.

Read the output yourself. For each sentence, ask:

1. Who acts?
2. What input do they use?
3. What changes or gets returned?
4. Does a failure explain what went wrong?
5. Can any word, sentence, or section be removed?

Run this review before the affected project's final checks. A word list or formatter cannot prove that prose is clear. Ask another reviewer to inspect wording for a substantial new product or security boundary.
