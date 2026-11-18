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

The single-node reference Replica decision runtime proves one complete customer-operated lifecycle. It keeps mutable job records under `jobs/`, writes each completed candidate once under `candidates/`, keeps immutable promotion generations under `promotions/`, and serves only the candidate an operator explicitly promotes or restores. Replica does not receive the taskset, adapter, reports, token, or requests.

The only backend in this first reference is deterministic and ignores image content. It uses the real taskset loader, proper-scoring evaluation, candidate store, promotion gate, rollback, and inference contract without a GPU or model download. Its candidates are for development and tests only; the runtime refuses to promote them when `--environment production`.

```sh
cd packages/learning/environments/brand-check
python3 examples/runtime_demo.py --out /tmp/replica-runtime-demo
```

The output shows two bounded jobs, immutable candidates, baseline and candidate test reports, two promotions, an explicit rollback, and one structured Build evaluation from the restored candidate. `candidate.evaluation.evidence.meanRewardDelta` states the fixture's measured gain over the 50% baseline, not real visual-model quality. The demo leaves its state in `/tmp/replica-runtime-demo/runtime` so an operator can inspect it.

For a taskset created by `replica-learning decision taskset`, make a runtime token, install the package, and start the service:

```sh
(umask 077 && python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > ~/.replica-runtime-token)
export REPLICA_RUNTIME_TOKEN="$(cat ~/.replica-runtime-token)"
uv venv --python 3.12
uv pip install -e .
.venv/bin/replica-decision-runtime \
  --environment development \
  --tenant local --repository github/example \
  --taskset /path/to/taskset --state /path/to/runtime-state --port 8010
```

`--tenant` and `--repository` assign the customer scope that every connector call receives. A single-user process may keep the defaults; a shared host must set both from its authenticated customer and repository context.

Submit and track a bounded fixture job, then promote its candidate:

```sh
curl -sS -H "Authorization: Bearer $REPLICA_RUNTIME_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"backend":"fixture","maxUpdates":12,"maxSeconds":30}' \
  http://127.0.0.1:8010/v1/jobs

curl -sS -H "Authorization: Bearer $REPLICA_RUNTIME_TOKEN" \
  http://127.0.0.1:8010/v1/jobs/<job id>

curl -sS -H "Authorization: Bearer $REPLICA_RUNTIME_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"candidateId":"<candidate id>","promotedBy":"<operator>"}' \
  http://127.0.0.1:8010/v1/promotions

curl -sS -H "Authorization: Bearer $REPLICA_RUNTIME_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rolledBackBy":"<operator>"}' \
  http://127.0.0.1:8010/v1/rollbacks
```

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
| `POST /v1/jobs` | Enqueues one job bounded by `maxUpdates` and `maxSeconds` |
| `GET /v1/jobs/<id>` | Returns `queued`, `running`, `succeeded`, or `failed` |
| `GET /v1/candidates/<id>` | Returns the immutable manifest and evaluation report |
| `POST /v1/promotions` | Moves the explicit promotion pointer to one candidate |
| `POST /v1/rollbacks` | Restores the immediately previous candidate as a new promotion generation |
| `GET /v1/promotion` | Returns the promoted candidate and generation |
| `POST /score`, `POST /v1/evaluations` | Evaluates one page with the promoted candidate |

### Run the fixture runtime in a container

Build the runtime image, mount the taskset read-only, and mount a separate durable directory read-write:

```sh
docker build -f server/runtime.Dockerfile -t replica-decision-runtime:dev .
mkdir -p /path/to/runtime-state
docker run --rm \
  -e REPLICA_RUNTIME_TOKEN \
  --user "$(id -u):$(id -g)" \
  -v /path/to/taskset:/data/taskset:ro \
  -v /path/to/runtime-state:/data/runtime \
  -p 127.0.0.1:8010:8010 \
  replica-decision-runtime:dev
```

The image contains no taskset, candidate, model, or credential. The runtime process must own the runtime-state directory because startup restricts its permissions to the owner. The example runs the process as the operator who created that directory. Without `--user`, the image runs as user 10001, so create and assign the mounted directory to that user first. Rootless Podman also needs `--userns=keep-id`.

### Replace the infrastructure

The runtime contract follows the lifecycle rather than the services of one cloud. [`connectors.py`](connectors.py) defines these replaceable responsibilities:

| Connector | Responsibility |
| --- | --- |
| Taskset | Resolve one validated, immutable taskset inside the requested tenant and repository scope |
| Artifact | Store and read bytes by a verified SHA-256 digest without changing stored content |
| Job | Create and cancel durable jobs, compare-and-swap their versions, and grant one expiring worker lease |
| Candidate | Store immutable model candidates and append explicit promotion or rollback generations |
| Training | Run one bounded training operation and return candidate artifacts and evaluation evidence |
| Inference | Evaluate one request with the explicitly promoted candidate |
| Credential | Acquire a short-lived credential restricted to one operation, audience, tenant, and repository |
| Observability | Attribute usage, optional cost, and provider diagnostics to the scoped operation |

Every call receives an `OperationContext`. It names the tenant, repository, owner, operation, idempotency key, monotonic deadline, and cooperative cancellation signal. A retry with the same idempotency key and input returns the first result. Reusing the key for different input is a conflict. Connectors must check cancellation and deadlines before causing side effects.

Artifacts and candidates are immutable. Their identities include content digests, and a connector must fail with an integrity error when bytes do not match the claimed digest. Job leases are exclusive until released or expired. Promotion is an append-only sequence: a caller supplies the generation it observed, and a stale caller gets a conflict instead of replacing a newer decision.

Connector failures use stable codes plus one category: invalid input, not found, conflict, unauthorized, integrity, cancelled, deadline exceeded, unavailable, or internal. Only a connector that knows an operation is safe to repeat marks its error retryable. Usage records always name the operation and customer scope; providers may add quantities and cost, but must not add provider-specific fields to the shared lifecycle records.

[`connector_conformance.py`](connector_conformance.py) returns one reusable `unittest` suite for a fresh connector bundle. Local and hosted implementations run that suite unchanged. Its contract-only fixture proves scope isolation, immutable content, idempotent retries, lease expiry, promotion generations, cancellation and deadlines, credential boundaries, error classification, and usage/cost attribution.

The current single-node runtime preserves its HTTP API, process-isolated training, and filesystem behavior. Compatibility adapters project the existing fixture backend onto the training and inference contracts and pass scoped contexts through credential and observability connectors. A backend and its configuration must remain serializable because installed runtimes execute training in a spawned process. The next layer can replace the embedded filesystem state with local connector implementations without changing orchestration or the HTTP API.

### Trust, data, and credential boundaries

- The operator chooses the host. The reference runtime never calls Replica or a cloud service. A later hosted implementation can keep the same job, candidate, promotion, and inference contracts.
- The operator or hosting layer assigns the tenant and repository scope. A connector must return not found, rather than reveal another scope's records.
- The taskset contains private screenshots, learning text, and labels. Mount it read-only. A training-consent withdrawal still requires the operator to delete the taskset and every candidate derived from that export.
- The runtime state contains adapters, evaluation reports, job errors, and the promotion pointer. Back it up or delete it under the customer's retention rules. Candidate files are created read-only and never updated in place.
- The runtime token authorizes training, promotion, candidate reads, and inference. Keep it in a protected file or secret store and pass it through the environment, not the command line or image.
- The service uses plain HTTP. Bind it to localhost as shown, or put customer-operated TLS and authentication in front of it before another host can connect.
- A backend is trusted code. The reference runtime checks the taskset first and bounds time and updates, but a later model backend can read the screenshots and return candidate artifacts.

## Train d1-omni-600M

[examples/train_d1_omni.py](examples/train_d1_omni.py) trains Liquid AI's d1-omni-600M against this environment with reinforcement learning. It keeps the released model frozen and, by default, trains a small readout of 1,025 numbers on top of it. The readout reads the model's internal state at each yes-or-no question's answer options and corrects the released model's answer. `--part head` trains the whole decision head instead, about 26 million of the model's 587 million parameters. On a synthetic taskset of 518 practice pages, the head's dev score rose from 0.685 to at best 0.753, barely above the 0.750 that answering 50% to every question earns, while its practice score rose much more. The readout raised the dev score to 0.807. Either way, the trainer learns from the rewards alone. Every 10 updates it scores the dev split and keeps the weights with the best dev reward, because a small taskset is easy to memorize.

Install the trainer's packages next to this one, download the model at the revision the example was written for, and start the server as above. The model runs its own code from its folder, so review that code before you run it.

```sh
uv pip install torch torchvision "transformers>=5.14" pillow
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
