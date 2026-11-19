# Brand check environment

This [OpenEnv](https://github.com/openenv/OpenEnv) environment lets a trainer post-train Replica's decision model with reinforcement learning (RL). Each episode shows the model screenshots of one page of a Build, sometimes after a reference image, and asks typed questions such as "Does this screen follow learning X?" The trainer answers every question with probabilities, and the environment scores them against labels derived from review comments. An episode has one step, so the environment is a contextual bandit. [ADR 0002](../../../../docs/adr/0002-decision-model-and-rl-environment.md) explains the design.

## What it reads

The server reads a taskset directory created by `replica-learning decision taskset`, as [Decision model](../../README.md#decision-model) describes. `REPLICA_TASKSET_DIR` names the directory and defaults to `/data/taskset`. The directory holds:

- `taskset.json`, which names the schema version and the export.
- `tasks.jsonl`, with one task per line: its images, questions, and labels.
- The image files that tasks name by relative path.

The server checks every task, image path, and image digest when it starts. If a check fails, the server stops, and the error names the line of `tasks.jsonl` to fix. Labels never appear in an observation before the step.

## Token

The server also reads a shared secret token from `REPLICA_ENV_TOKEN`. Every request except `GET /health` must send it in the header `Authorization: Bearer <token>`. The server refuses to start unless the token has at least 32 letters, digits, or punctuation characters.

Make a token once and keep it in a file that only your account can read. `umask 077` creates the file that way. Then load the token in each shell that runs the server, the container, or a trainer:

```sh
(umask 077 && python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > ~/.replica-env-token)
export REPLICA_ENV_TOKEN="$(cat ~/.replica-env-token)"
```

The commands below assume that `REPLICA_ENV_TOKEN` is set.

## Run it with uv

```sh
cd packages/learning/environments/brand-check
uv venv --python 3.12
uv pip install -e .
REPLICA_TASKSET_DIR=/path/to/taskset .venv/bin/server --port 8000
```

The server listens on 127.0.0.1 unless you pass `--host`. `curl http://127.0.0.1:8000/health` returns `{"status":"healthy"}` without the token.

The tests need only Python 3.10 or later. The end-to-end test runs when OpenEnv is installed, as it is in `.venv`, and is skipped otherwise:

```sh
.venv/bin/python -m unittest discover -s tests -t .
```

## Run it in a container

Docker and Podman accept the same commands. Build the image from this directory, then mount the taskset read-only:

```sh
docker build -f server/Dockerfile -t replica-brand-check:dev .
docker run --rm -e REPLICA_ENV_TOKEN -v /path/to/taskset:/data/taskset:ro -p 127.0.0.1:8000:8000 replica-brand-check:dev
```

`-e REPLICA_ENV_TOKEN` without a value passes the token from your shell's environment. This keeps the token off the command line, where other accounts could read it in the process list.

On Apple Silicon, add `--platform linux/amd64` to `docker build` when you push the image to an x86 host.

The `docker run` command publishes the port on localhost only. When the trainer runs on another host, put a TLS proxy or a managed service's HTTPS ingress in front of the container. Do not publish the environment's plaintext port directly.

The server runs as user 10001, which must be able to read the taskset. If only your account can read it, add `--user "$(id -u):$(id -g)"` to `docker run`. Rootless Podman also needs `--userns=keep-id`.

## Connect a trainer

A trainer uses the WebSocket client in [client.py](client.py). `BrandCheckEnv` sends the token from `REPLICA_ENV_TOKEN`, or from its `token` argument, in the `Authorization` header. Any other client must send the same header. Without it, the server answers an HTTP request with status 401 and refuses a WebSocket handshake with status 403.

`BrandCheckEnv` requires HTTPS by default. On a single-user machine, `allow_insecure_loopback=True` explicitly permits plaintext HTTP to `localhost`, `127.0.0.1`, or `::1`; the client disables proxy discovery for that connection. Do not use this option on a shared host, where another account could impersonate a stopped loopback server and collect the reusable token. A shared-host or remote trainer must use an `https://` address whose ingress authenticates the server and terminates TLS before forwarding to the container.

Each client connection gets its own session. The server accepts four sessions at once and refuses more connections until one closes.

```python
from replica_brand_check import BrandCheckAction, BrandCheckEnv, question_options

with BrandCheckEnv(
    base_url="http://127.0.0.1:8000",
    allow_insecure_loopback=True,
).sync() as env:
    result = env.reset(split="train")
    observation = result.observation
    answers = {}
    for key, question in observation.questions.items():
        options = question_options(question)
        probabilities = model.predict(observation.images, observation.state, question, options)
        answers[key] = {"probabilities": dict(zip(options, probabilities))}
    result = env.step(BrandCheckAction(answers=answers))
    print(result.reward, result.observation.rewards)
```

`model.predict` stands for your model. It returns one probability for each option, in option order.

The observation's `images` are data URIs: an optional reference image, then the page's screenshots in the order desktop light, desktop dark, narrow light, narrow dark. A task holds only the screenshots its Build has, and `state.imagesNote` says which image is which. A narrow screenshot is about as wide as a phone. A trainer for a model that accepts only one image can tile the images into one.

Reset observations omit the task's full rules list. Each typed question carries only its own `learning_text` data, and the reference trainer sends that value as a JSON-quoted string inside an explicit data envelope. Accepted learning text therefore never becomes task state or question instructions.

All of a task's images arrive in one message. Five images at the 25 MiB limit make a message of about 170 MiB, more than OpenEnv's default limit of 100 MiB, so `BrandCheckEnv` sets `max_message_size_mb` to 183 unless you pass another value. Any other client needs a limit that large.

Reset accepts these options and refuses others:

- `split`: `train`, `dev`, or `test`. The default is `train`.
- `seed`: draws the same task from the split every time.
- `task_id`: selects one task from any split.
- `episode_id`: names the episode in the state.

After the step, the observation fields `rewards` and `invalid` hold the per-question reward and any missing or invalid answer, and `metadata` holds the same values. The environment never sends the ground-truth labels or a separate correctness flag to the trainer. A step before reset, or a second step, makes the client raise `RuntimeError` with a message that says to call reset. The session stays open for the next reset.

In OpenEnv 0.3.0, HTTP `/reset` and `/step` create a new environment for every request, so HTTP `/step` always answers 409. Train through the WebSocket client.

## Action format

```json
{"answers": {"<question key>": {"probabilities": {"<option>": 0.7, "<option>": 0.3}}}}
```

| Question type | Options |
| --- | --- |
| `noul` | `yes` and `no` |
| `choice` | The keys of `criteria` |
| `score` | `"0"` to `"K-1"` for the K levels in `criteria`, lowest first |

A distribution is valid when every key is an option of its question, every value is a finite number from 0 to 1, and the values sum to 1 within 0.001. A missing option counts as 0, and the environment rescales the values to sum to exactly 1. A labeled question with a missing or invalid answer earns 0 and appears in `invalid`. Answers to unlabeled questions are ignored.

## Reward

Each labeled question earns a reward from 0 to 1. The episode reward is the mean over the labeled questions.

```text
noul     r = 1 - (p - y)^2
         p = P(yes); y = 1 for a true label, else 0
choice   r = 1 - 0.5 * sum_k (p_k - [k = answer])^2
         [k = answer] = 1 for the labeled option, else 0
score    r = 1 - RPS
         RPS = 1/(K-1) * sum_{k=0}^{K-2} (F_p(k) - F_y(k))^2
         F_p(k) = sum_{j<=k} p_j; F_y(k) = 1 if k >= answer, else 0
```

These are proper scoring rules, so the model earns the most expected reward by reporting the probabilities it believes, which keeps its probabilities honest during RL.

Answering 0.5 to a noul question earns 0.75 whatever the label. A trained model must beat this baseline. [examples/uniform_policy.py](examples/uniform_policy.py) measures it against a running server, with the token from `REPLICA_ENV_TOKEN`:

```sh
.venv/bin/python examples/uniform_policy.py http://127.0.0.1:8000 \
  --allow-insecure-loopback --episodes 20
```

## Evaluate a candidate

Write the candidate's answers to a JSON Lines file with one `{"taskId": "...", "answers": {...}}` per task, using the action format for `answers`. Then score one split:

```sh
.venv/bin/python -m replica_brand_check.evaluate --taskset /path/to/taskset --predictions predictions.jsonl --split dev
```

The command prints a JSON report:

- `tasks` counts the tasks in the split, and `missingTasks` counts those without a prediction. The metrics cover tasks with a prediction.
- `noul` gives accuracy, where the prediction is yes when P(yes) is at least 0.5. It also gives balanced accuracy overall and for each rule in `byRule`, the Brier score, and the expected calibration error (`ece`).
- `choice` gives accuracy, the Brier score, and `ece`.
- `score` gives accuracy, the ranked probability score (`rps`), and the mean absolute error of the expected level.
- `meanReward` is the mean episode reward, computed by the environment's reward code.

A missing or invalid answer counts as wrong for accuracy and as `invalid`, and it is left out of the other scores. A metric without data is `null`.

## Run the single-node reference runtime

The single-node reference Replica decision runtime proves one complete customer-operated lifecycle. It keeps mutable job records under `jobs/`, writes each completed candidate once under `candidates/`, keeps immutable promotion generations under `promotions/`, and serves only the candidate an operator explicitly promotes or restores. Job limits, authoritative connector usage, promotion generations, and retry records live in the mounted state directory, so restart recovery does not reset a budget or let a stale operator overwrite a newer pointer. Replica does not receive the taskset, adapter, reports, token, or requests.

The default installation configures only a deterministic fixture backend that ignores image content. It uses the real taskset loader, proper-scoring evaluation, candidate store, promotion gate, rollback, and inference contract without a GPU or model download. Its candidates are for development and tests only; the runtime refuses to promote them when `--environment production`.

The optional `d1-omni` backend runs the pinned Liquid AI d1-omni-600M base model on customer-controlled hardware. Training returns only the trained readout or head adapter plus baseline and candidate test reports. The candidate store keeps those two artifacts and the normal immutable manifest; it does not copy the base model. Inference loads that pinned base plus the explicitly promoted adapter and returns the same structured probabilities as the fixture backend.

```sh
cd packages/learning/environments/brand-check
python3 examples/runtime_demo.py --out /tmp/replica-runtime-demo
```

The output shows two bounded jobs, immutable candidates, baseline and candidate test reports, two promotions, an explicit rollback, and one structured Build evaluation from the restored candidate. `candidate.evaluation.evidence.meanRewardDelta` states the fixture's measured gain over the 50% baseline, not real visual-model quality. The demo leaves its state in `/tmp/replica-runtime-demo/runtime` so an operator can inspect it.

For a taskset created by `replica-learning decision taskset`, make a runtime token, install the package, and start the service. `--taskset` remains available for a read-only local default, but Hub and other control planes should start the runtime without it and use the authenticated upload route.

```sh
(umask 077 && python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > ~/.replica-runtime-token)
export REPLICA_RUNTIME_TOKEN="$(cat ~/.replica-runtime-token)"
uv venv --python 3.12
uv pip install -e .
.venv/bin/replica-decision-runtime \
  --environment development \
  --tenant local --repository github/example \
  --state /path/to/runtime-state --port 8010
```

That is the explicit fixture-only installation. It has no PyTorch or model dependency and does not validate model quality.

For the real connector, install the optional model dependencies, download the pinned revision, review its model-supplied Python, and allowlist only that absolute directory:

```sh
uv pip install -e ".[model]"
hf download LiquidAI/d1-omni-600M \
  --revision 02b55d7076f15129e59ab3f94783f32c4b088674 \
  --local-dir models/d1-omni-600M
export REPLICA_TRUSTED_MODEL_DIRS="$(pwd)/models/d1-omni-600M"
.venv/bin/replica-decision-runtime \
  --environment development \
  --tenant local --repository github/example \
  --taskset /path/to/taskset --state /path/to/runtime-state \
  --d1-model "$(pwd)/models/d1-omni-600M" --port 8010
```

Keep the `.cache/huggingface/download` metadata when moving this directory. The runtime verifies every pinned artifact's metadata and SHA-256 digest before loading model code or weights. Changing the base-model revision invalidates existing adapters; retrain and explicitly promote a candidate built against the new pin.

Submit a real job with `"backend":"d1-omni"`. The runtime applies the same update and wall-time bounds, operation scope, taskset pin, durable lease, idempotency, cancellation, candidate evidence, promotion, and usage reporting as the fixture path. The local model backend needs no external credential, so the runtime does not mint one for its training or inference calls.

| Host | Training | Inference | Meaning |
| --- | --- | --- | --- |
| NVIDIA with PyTorch CUDA | Supported | Supported | Real local model execution and evaluation evidence |
| Apple silicon with PyTorch MPS | Supported | Supported | Real local model execution and evaluation evidence |
| CPU with model dependencies | Rejected | Supported for smoke and low-volume checks | Does not validate training quality or representative performance |
| Default fixture-only install | Fixture only | Fixture only | Validates orchestration, not model quality |

`GET /ready` reports backend capability, accelerator, dependency and model status, and `coldStart` without exposing the private model path, taskset digest, or promoted candidate ID. The single-node runtime intentionally starts a bounded child for every inference request, so the d1 backend reports `coldStart: "per-request"` and reloads the base model each time. It admits one d1 inference request at a time and returns `capacity_temporarily_unavailable` while that model load is active. This favors isolation, bounded memory use, and enforceable deadlines over latency; a hosted inference connector can keep a warm model without changing the lifecycle contracts.

Before spending a training budget, run one opt-in real-model smoke check:

```sh
.venv/bin/replica-d1-omni-smoke \
  --model "$(pwd)/models/d1-omni-600M" \
  --taskset /path/to/taskset
```

Add `--adapter /path/to/adapter.pt` to load a promoted-format adapter. The command reports the accelerator and elapsed time and deliberately prints `qualityValidated: false`; one successful forward pass is not evaluation evidence.

`--tenant` and `--repository` assign the customer scope that every connector call receives. A single-user process may keep the defaults; a shared host must set both from its authenticated customer and repository context.

Upload the complete taskset as one JSON object. The route digest is the lowercase SHA-256 value from the taskset's stable content identity. The body uses `replica.decision-taskset-upload/v1`, with `manifest`, ordered `tasks`, and one base64 image record for each distinct relative image path. Each image record contains `path`, `mediaType`, its `sha256:<hex>` digest, and `dataBase64`. The runtime validates the manifest and task contracts, path containment, image digests, image counts, and size limits before its taskset connector stores anything.

```sh
curl -sS -X PUT \
  -H "Authorization: Bearer $REPLICA_RUNTIME_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: taskset-<digest>" \
  --data-binary @taskset-upload.json \
  http://127.0.0.1:8010/v1/tasksets/<64-character digest>
```

Repeating the same upload returns the registered taskset. Reusing an idempotency key for different input returns `409 idempotency_conflict`. A digest that already identifies different content is never replaced. The runtime binds every connector operation to its configured tenant and repository; another scope receives not found rather than record details.

Submit and track a bounded fixture job, then promote its candidate:

```sh
curl -sS -H "Authorization: Bearer $REPLICA_RUNTIME_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"backend":"fixture","tasksetDigest":"sha256:<digest>","maxUpdates":12,"maxSeconds":30,"maxCredits":12,"budgetMode":"hard"}' \
  http://127.0.0.1:8010/v1/jobs

curl -sS -H "Authorization: Bearer $REPLICA_RUNTIME_TOKEN" \
  http://127.0.0.1:8010/v1/jobs/<job id>

curl -sS -X POST \
  -H "Authorization: Bearer $REPLICA_RUNTIME_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: cancel-<job id>" \
  -d '{}' \
  http://127.0.0.1:8010/v1/jobs/<job id>/cancel

curl -sS -H "Authorization: Bearer $REPLICA_RUNTIME_TOKEN" \
  -H "Content-Type: application/json" \
-H "Idempotency-Key: promote-<candidate id>-from-<generation>" \
-d '{"candidateId":"<candidate id>","promotedBy":"<operator>","expectedGeneration":0}' \
  http://127.0.0.1:8010/v1/promotions

curl -sS -H "Authorization: Bearer $REPLICA_RUNTIME_TOKEN" \
  -H "Content-Type: application/json" \
-H "Idempotency-Key: rollback-from-<generation>" \
-d '{"rolledBackBy":"<operator>","expectedGeneration":2}' \
  http://127.0.0.1:8010/v1/rollbacks
```

`maxCredits` is a finite hard ceiling from 1 to 1,000,000. A hard-budget connector must stop before it exceeds that ceiling and return its measured usage. The local fixture charges one credit per completed update and reports the connector's billed cost as `0 USD`; it does not estimate infrastructure cost. A connector that cannot enforce the ceiling is rejected before the job is created. Development and test callers may explicitly choose `budgetMode: "unmetered_local"` for such a local connector; production refuses that mode. Job and candidate results include the connector's authoritative `usage` records with quantity, unit, cost, currency, and source.

Promotion and rollback bodies must carry the generation the operator read. A stale `expectedGeneration` returns `409 promotion_generation_conflict` without validating a candidate or moving the pointer. Retrying the exact request with the same `Idempotency-Key` returns its already-appended generation, including after process restart. Reusing the key for another candidate, generation, or operation returns `409 idempotency_conflict`.

`POST /score` and `POST /v1/evaluations` accept a task-shaped request with `state`, image data URIs, and `questions`. Send the runtime token as a bearer token. The fixture ignores the screenshots, so do not use its answers to judge a Build or guide authoring. The response includes probability `answers`, the promoted candidate ID, promotion generation, and one `followsProbability` and `breaksProbability` pair per learning. Inference returns `409 candidate_not_promoted` until an operator promotes a candidate.

```sh
curl -sS -H "Authorization: Bearer $REPLICA_RUNTIME_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @request.json \
  http://127.0.0.1:8010/score
```

The HTTP contract stays independent of the local store and trainer implementation:

| Route | Result |
| --- | --- |
| `GET /health` | Process liveness; no token required |
| `GET /ready` | Returns 200 only when an intact promoted candidate has a configured backend; no token required |
| `PUT /v1/tasksets/<digest>` | Validates and immutably registers one complete private taskset |
| `POST /v1/jobs` | Enqueues one job bounded by `maxUpdates`, `maxSeconds`, and required `maxCredits` |
| `GET /v1/jobs/<id>` | Returns `queued`, `running`, `succeeded`, `failed`, or `cancelled` |
| `POST /v1/jobs/<id>/cancel` | Idempotently cancels a queued or running job; completed jobs return `409 job_terminal` |
| `GET /v1/candidates/<id>` | Returns the immutable manifest and evaluation report |
| `POST /v1/promotions` | Moves the pointer when required `expectedGeneration` still matches; exact idempotent retries return the applied generation |
| `POST /v1/rollbacks` | Restores the previous candidate as a new generation when required `expectedGeneration` still matches |
| `GET /v1/promotion` | Returns the promoted candidate and generation |
| `POST /score`, `POST /v1/evaluations` | Evaluates one page with the promoted candidate |

### Run the fixture runtime in a container

Build the runtime image and mount a durable private directory read-write. Upload tasksets through the authenticated API after startup.

```sh
docker build -f server/runtime.Dockerfile -t replica-decision-runtime:dev .
mkdir -p /path/to/runtime-state
docker run --rm \
  -e REPLICA_RUNTIME_TOKEN \
  --user "$(id -u):$(id -g)" \
  -v /path/to/runtime-state:/data/runtime \
  -p 127.0.0.1:8010:8010 \
  replica-decision-runtime:dev
```

The image contains no taskset, candidate, model, or credential. The runtime process must own the runtime-state directory because startup restricts its permissions to the owner. The example runs the process as the operator who created that directory. Without `--user`, the image runs as user 10001, so create and assign the mounted directory to that user first. Rootless Podman also needs `--userns=keep-id`.

The included Compose file wires the fixture-only local bundle without a GPU or external service:

```sh
mkdir -p /path/to/runtime-state
chmod 700 /path/to/runtime-state
export REPLICA_RUNTIME_TOKEN="$(cat ~/.replica-runtime-token)"
export REPLICA_RUNTIME_STATE_DIR=/absolute/path/to/runtime-state
export REPLICA_RUNTIME_TENANT=local
export REPLICA_RUNTIME_REPOSITORY=github/example
export REPLICA_RUNTIME_USER="$(id -u):$(id -g)"
docker compose up --build
```

Compose binds the service only to localhost and mounts the private runtime state read-write. Upload a taskset, submit a hard-budget job that names its digest, cancel a queued or running job, and repeat promotion or rollback requests with the same generation and idempotency key to exercise restart-safe retries. Keep `REPLICA_RUNTIME_STATE_DIR` on durable storage: it holds job budgets, connector-reported usage, generation history, and retry records. The local factory binds the directory permanently to the configured tenant and repository, so reopening it under another scope fails instead of exposing the first scope's tasksets, jobs, or candidates.

### Replace the infrastructure

The runtime contract follows the lifecycle rather than the services of one cloud. [`connectors.py`](connectors.py) defines the interfaces, and [`local_connectors.py`](local_connectors.py) composes the complete single-node implementation:

| Interface | Local implementation | Future hosted responsibility |
| --- | --- | --- |
| Taskset | `LocalTasksetConnector` validates optional mounted input plus uploaded bundles and keeps uploaded tasksets in private immutable digest paths | Register and resolve a private taskset object after checking tenant and repository access |
| Artifact | `LocalArtifactConnector` keeps verified immutable bytes under private SHA-256 paths | Keep immutable candidate inputs and outputs in private content-addressed storage |
| Job | `LocalJobConnector` keeps atomic JSON records, compare-and-swap versions, durable cancellation, idempotency records, and requires the active expiring worker lease for each state update | Keep durable job state and fence each transactional update through one worker lease |
| Candidate | `LocalCandidateConnector` keeps read-only candidate files, verifies their digests, and appends generation-checked promotion or rollback decisions with durable idempotency records | Keep immutable candidate manifests and artifacts, with a transactional generation-checked promotion pointer and exact retry result |
| Training | `LocalTrainingConnector` runs the fixture or real d1 backend inside the bounded local worker, enforces supported hard credit budgets before work, and returns persistable adapter bytes, evaluation evidence, and authoritative usage | Reject unsupported hard budgets before scheduling, stop before exceeding measurable limits, and return the same candidate evidence, authoritative usage, and billed cost |
| Inference | `LocalInferenceConnector` serves the explicitly promoted fixture adapter or verified pinned d1 base plus promoted adapter | Send evaluation requests only to the explicitly promoted model deployment |
| Credential | `LocalCredentialConnector` mints short-lived operation-bound credentials from a private installation key | Acquire workload or brokered credentials restricted to the operation, audience, tenant, and repository |
| Observability | `LocalObservabilityConnector` appends scoped usage, optional cost, and metadata to private JSON Lines | Send the same scoped usage and cost records to the operator's telemetry and billing sinks |

`create_local_connector_bundle` is the composition boundary. `LocalRuntime` uses that factory for tasksets, artifacts, jobs, candidates, training, inference, credentials, and observability; it no longer keeps a second filesystem implementation beside the connectors. Existing `jobs/`, `candidates/`, `promotions/`, and `promotion.json` data remains readable. The factory adds private connector metadata beside it and migrates an existing candidate descriptor when the candidate is first read.

Every call receives an `OperationContext`. It names the tenant, repository, owner, operation, idempotency key, monotonic deadline, and cooperative cancellation signal. A retry with the same idempotency key and input returns the first result. Reusing the key for different input is a conflict. Connectors must check cancellation and deadlines before causing side effects.

Artifacts and candidates are immutable. Their identities include content digests, and a connector must fail with an integrity error when bytes do not match the claimed digest. Job leases are exclusive until released or expired. Every versioned update presents the active lease, so a worker whose lease expired or was replaced cannot write even when it still knows the current job version. Promotion is an append-only sequence: a caller supplies the generation it observed, and a stale caller gets a conflict instead of replacing a newer decision.

Connector failures use stable codes plus one category: invalid input, not found, conflict, unauthorized, integrity, cancelled, deadline exceeded, unavailable, or internal. Only a connector that knows an operation is safe to repeat marks its error retryable. Usage records always name the operation and customer scope; providers may add quantities and cost, but must not add provider-specific fields to the shared lifecycle records.

[`connector_conformance.py`](connector_conformance.py) returns one reusable `unittest` suite for a fresh connector bundle. Local and hosted implementations run that suite unchanged. Its contract-only fixture proves tenant and repository isolation across every stored record, immutable content, idempotent retries, lease expiry and fencing, promotion generations, cancellation and deadlines, persistable training output, credential boundaries, error classification, and usage/cost attribution.

The single-node runtime preserves its HTTP API and lifecycle behavior while every infrastructure operation goes through the local bundle. Installed runtimes execute training and each inference request in a spawned process, so a backend and its configuration must remain serializable. Each inference request pays process-startup cost, and model state loaded inside one inference child is not retained for the next request. A future hosted bundle replaces the implementations, not the lifecycle records or routes, and must pass the same suite without provider-specific fields in the shared contracts.

### Run the Azure reference connectors

[`azure_connectors.py`](azure_connectors.py) is the first hosted reference bundle. It remains customer-operated: the Blob account, PostgreSQL server, Container Apps environment, GPU quota, inference endpoint, identities, logs, and charges all stay in the customer's Azure subscription. Replica does not receive tasksets, candidates, reports, prompts, credentials, or telemetry.

The mapping keeps the provider-neutral lifecycle unchanged:

| Contract | Azure reference |
| --- | --- |
| Taskset and artifact | A private Azure Blob container with shared-key access disabled. Keys start with a repository scope hash, bytes are verified against SHA-256 digests, and conditional creates reject replacement. Storage versioning and soft delete support recovery, and a lifecycle rule expires superseded decision versions. The optional retention callback records customer policy. An authorized withdrawal purger calls `delete`, which permanently removes the current Blob and every version. |
| Job | Tables in the installation's existing PostgreSQL database hold the job record, compare-and-swap version, create idempotency key, durable cancellation, and expiring fenced lease. Run `initialize_azure_postgres` from the existing migration boundary; do not create another database service. |
| Candidate and promotion | Candidate artifacts and reports use Blob; immutable descriptors and append-only promotion generations use PostgreSQL. Promotion and rollback compare the expected generation in the same transaction. |
| Training | `AzureContainerAppsTrainingConnector` starts one manual Azure job execution, passes the deadline and credit limits, polls a bounded execution, and cancels Azure work when the runtime is cancelled or expires. The job result is authoritative for usage and cost when Azure supplies them. The transport can be replaced by Azure Machine Learning without changing the runtime contract. |
| Inference | `AzureEndpointInferenceConnector` calls only readiness and prediction operations on a customer endpoint. Every request names its expected promotion generation; startup or deployment drift is reported as retryable readiness or generation failure rather than scoring with another model. |
| Credential | `AzureManagedIdentityCredentialConnector` accepts only configured audiences and wraps short-lived workload-identity tokens. Its lifetime never exceeds the operation deadline, and it has no key or secret persistence path. |
| Observability | `AzureObservabilityConnector` emits usage and operational attributes to an injected Pino/OpenTelemetry bridge. It hashes tenant and repository names and allowlists provider metadata; screenshots, prompts, learning text, artifacts, and credential values cannot enter this signal. |

The connector module deliberately takes narrow injected clients instead of adding Azure SDK dependencies to the environment. An embedding service may adapt the official Blob, identity, Container Apps Jobs, PostgreSQL, OpenTelemetry, and HTTP clients to those interfaces. Tests use in-memory clients and need no Azure account.

The Terraform reference under `infrastructure/azure` adds an optional private `decision-runtime` container and separate runtime and inference user-assigned identities. It grants the customer GPU Job's separate managed identity access only to the decision container. The runtime identity invokes a customer broker that starts and cancels one fixed job template; it never receives direct Container Apps Jobs Operator access because that role can list secrets and override images, commands, and environment variables at execution time. The job stays outside the module because the repository-pinned AzureRM provider does not yet accept Azure's serverless GPU workload profile types. The inference identity receives a customer-supplied custom role on the customer endpoint; that role must permit inference only, not training, deployment, or endpoint administration.

Serverless GPU regions and quota are limited. A T4 profile is cheaper and smaller than A100, but either can have several minutes of image-pull and GPU allocation cold start after scaling to zero. The customer job must use a manual trigger, zero idle GPU capacity, one execution replica, no automatic retry, an immutable image, and a hard execution timeout. The job connector reports startup delay through job state and still applies the caller deadline. A customer that needs reserved capacity or Azure Machine Learning can replace only the job transport and inference transport. Azure's usage or Cost Management export remains the billing authority.

### Trust, data, and credential boundaries

- The operator chooses the host. The reference runtime never calls Replica or a cloud service. A later hosted implementation can keep the same job, candidate, promotion, and inference contracts.
- The operator or hosting layer assigns the tenant and repository scope. A storage connector must return not found, rather than reveal another scope's records. A credential connector must reject another tenant or repository as unauthorized without minting a credential.
- The taskset contains private screenshots, learning text, and labels. Mount it read-only. A training-consent withdrawal still requires the operator to delete the taskset and every candidate derived from that export.
- The runtime state contains adapters, evaluation reports, job errors, the promotion pointer, `credentials/local.key`, and the append-only `observability/usage.jsonl` usage and cost log. Back it up or delete it under the customer's retention rules. Candidate files and the local credential key are created read-only and never updated in place. The runtime does not rotate or prune the usage log; the operator must do that while the runtime is stopped.
- The runtime token authorizes training, promotion, candidate reads, and inference. Keep it in a protected file or secret store and pass it through the environment, not the command line or image.
- The service uses plain HTTP. Bind it to localhost as shown, or put customer-operated TLS and authentication in front of it before another host can connect.
- A backend is trusted code. The reference runtime checks the taskset first and bounds time and updates, but a later model backend can read the screenshots and return candidate artifacts.
- The Azure inference identity must be separate from the training and runtime identities. Its customer-defined role may invoke the selected endpoint only. Do not assign Azure ML Contributor, Data Scientist, Container Apps Jobs Operator, Blob contributor, or another training/administration role to that identity.
- Do not give the runtime identity permanent-delete permission. Run withdrawal deletion through a separate customer workflow that rechecks the affected export, uses a dedicated short-lived identity, calls the connector's permanent version deletion, and records the result in the customer's audit system.

## Train d1-omni-600M

[examples/train_d1_omni.py](examples/train_d1_omni.py) trains Liquid AI's d1-omni-600M against this environment with reinforcement learning. It keeps the released model frozen and, by default, trains a small readout of 1,025 numbers on top of it. The readout reads the model's internal state at each yes-or-no question's answer options and corrects the released model's answer. `--part head` trains the whole decision head instead, about 26 million of the model's 587 million parameters. On a synthetic taskset of 518 practice pages, the head's dev score rose from 0.685 to at best 0.753, barely above the 0.750 that answering 50% to every question earns, while its practice score rose much more. The readout raised the dev score to 0.807. Either way, the trainer learns from the rewards alone. Every 10 updates it scores the dev split and keeps the weights with the best dev reward, because a small taskset is easy to memorize.

Install the `model` extra, download the pinned model revision, and start the server as above. The model runs its own code from its folder, so review that code before you run it.

```sh
uv pip install -e ".[model]"
hf download LiquidAI/d1-omni-600M --revision 02b55d7076f15129e59ab3f94783f32c4b088674 --local-dir models/d1-omni-600M
export REPLICA_TRUSTED_MODEL_DIRS="$(pwd)/models/d1-omni-600M"
.venv/bin/python examples/train_d1_omni.py train --allow-insecure-loopback --model models/d1-omni-600M --taskset /path/to/taskset --out runs/demo
.venv/bin/python examples/train_d1_omni.py evaluate --allow-insecure-loopback --model models/d1-omni-600M --taskset /path/to/taskset --trained runs/demo/best.pt --split test --out runs/demo
```

Training requires at least one task in both the train and dev splits. Evaluation requires at least one task in the selected split. Training reads `--taskset` only to list the tasks in each split; the server scores every answer. The `evaluate` command also reads that split's labels from the taskset to write its report. Both commands read each task's screenshots through the model once and keep the result in memory, so the first pass over the tasks is the slow part. To train the readout, it first reads every practice page to scale the readout's inputs, which uses no labels. Choose the settings and the trained weights on the dev split, then score the test split once.

The trainer restricts the output directory to mode `0700` and its logs, weights, predictions, and reports to `0600`. Evaluation reports include review-derived label counts, so keep the output private even after deleting the taskset.

`REPLICA_TRUSTED_MODEL_DIRS` is an independent approval gate for model-supplied Python code. It must list the reviewed model directory as an absolute path before the trainer loads it. Separate several approved paths with the operating system's path separator.

## Privacy

The taskset holds private prototype screenshots and labels derived from review comments. Run the container where your team controls the data. Keep local traffic on loopback; for a remote trainer, terminate TLS in front of the container so the token and screenshots stay encrypted in transit.

The token keeps other accounts on the host, and web pages in your browser, from reading the taskset through the server. A web page can open a WebSocket to any port your browser can reach, but it cannot add the token to the request. Keep the token in a file that only your account can read.

Never bake a taskset or the token into an image: mount the taskset and pass the token when the container starts. A managed OpenEnv-compatible service can run the same image only if your team's training consent covers sending the data there and its connection uses HTTPS.
