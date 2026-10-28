# Conditional clarification

Read only when missing information would materially change the target, scope,
behavior, fidelity or feasibility. This can happen before dispatch or within
either selected workflow. Do not load this file for a clear request.

1. Reconstruct the request from the original message plus every answer already
   given. Keep their wording in session context. Freeform answers are
   authoritative, not forced into a multiple-choice label. A selected choice
   answers only its question and cannot narrow unrelated scope.
2. Resolve what a short, targeted lookup or existing approved context can
   answer before asking. Missing context documents go through the existing
   `setup-skills` path described by the authoring reference,
   not a replacement per-task policy interview.
3. Ask only the highest-impact unresolved question, one at a time. Prefer
   concrete user outcomes to technical implementation choices. Skip mode,
   seed-selection and framework questions when the request or context already
   decides them. Do not use a fixed questionnaire.
4. After each answer, reconstruct the whole request again. Stop asking as soon
   as the remaining decisions are supported or low-stakes and reversible.
   State any such assumptions rather than treating them as user requirements.
   If the user says "just go", make only safe, reversible assumptions. Do not
   invent missing design evidence, authorization or an ambiguous edit target.
5. If the user cannot answer a blocking question, report it and pause that
   part of the task. Silence is not approval. Preserve supported independent
   scope, but do not silently discard blocked requirements to claim completion.
6. Return to the workflow already selected. If dispatch was unresolved, decide
   create versus iterate now and load only that workflow. Do not restart
   intake, persist a mandatory brief or load both workflows.

Example: "Add a search field and export to this prototype" still includes
export after the user answers a question about which fields search covers.
A missing export format might need another question. It does not turn this
into a new prototype or authorize removing export from scope.
