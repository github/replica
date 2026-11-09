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

The `docker run` command publishes the port on localhost only. When the trainer runs on another host, publish the port on a private network address instead.

The server runs as user 10001, which must be able to read the taskset. If only your account can read it, add `--user "$(id -u):$(id -g)"` to `docker run`. Rootless Podman also needs `--userns=keep-id`.

## Connect a trainer

A trainer uses the WebSocket client in [client.py](client.py). `BrandCheckEnv` sends the token from `REPLICA_ENV_TOKEN`, or from its `token` argument, in the `Authorization` header. Any other client must send the same header. Without it, the server answers an HTTP request with status 401 and refuses a WebSocket handshake with status 403.

Each client connection gets its own session. The server accepts four sessions at once and refuses more connections until one closes.

```python
from replica_brand_check import BrandCheckAction, BrandCheckEnv, question_options

with BrandCheckEnv(base_url="http://127.0.0.1:8000").sync() as env:
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

All of a task's images arrive in one message. Five images at the 25 MiB limit make a message of about 170 MiB, more than OpenEnv's default limit of 100 MiB, so `BrandCheckEnv` sets `max_message_size_mb` to 183 unless you pass another value. Any other client needs a limit that large.

Reset accepts these options and refuses others:

- `split`: `train`, `dev`, or `test`. The default is `train`.
- `seed`: draws the same task from the split every time.
- `task_id`: selects one task from any split.
- `episode_id`: names the episode in the state.

After the step, the observation fields `rewards`, `correct`, `invalid`, and `labels` hold the results for each labeled question, and `metadata` holds the same values. A step before reset, or a second step, makes the client raise `RuntimeError` with a message that says to call reset. The session stays open for the next reset.

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
.venv/bin/python examples/uniform_policy.py http://127.0.0.1:8000 --episodes 20
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

## Train d1-omni-600M

[examples/train_d1_omni.py](examples/train_d1_omni.py) trains Liquid AI's d1-omni-600M against this environment with reinforcement learning. It keeps the released model frozen and, by default, trains a small readout of 1,025 numbers on top of it. The readout reads the model's internal state at each yes-or-no question's answer options and corrects the released model's answer. `--part head` trains the whole decision head instead, about 26 million of the model's 587 million parameters. On a synthetic taskset of 518 practice pages, the head memorized those pages and never beat answering 50% on new ones, while the readout did. Either way, the trainer learns from the rewards alone. Every 10 updates it scores the dev split and keeps the weights with the best dev reward, because a small taskset is easy to memorize.

Install the trainer's packages next to this one, download the model at the revision the example was written for, and start the server as above. The model runs its own code from its folder, so review that code before you run it.

```sh
uv pip install torch "transformers>=5.14" pillow
hf download LiquidAI/d1-omni-600M --revision 02b55d7076f15129e59ab3f94783f32c4b088674 --local-dir models/d1-omni-600M
.venv/bin/python examples/train_d1_omni.py train --model models/d1-omni-600M --taskset /path/to/taskset --out runs/demo
.venv/bin/python examples/train_d1_omni.py evaluate --model models/d1-omni-600M --taskset /path/to/taskset --trained runs/demo/best.pt --split test --out runs/demo
```

The trainer reads `--taskset` only to list the tasks in each split; the server scores every answer. It reads each task's screenshots through the model once and keeps the result in memory, so the first pass over the tasks is the slow part. To train the readout, it first reads every practice page to scale the readout's inputs, which uses no labels. Choose the settings and the trained weights on the dev split, then score the test split once.

## Privacy

The taskset holds private prototype screenshots and labels derived from review comments. Run the container where your team controls the data, and keep its port on a private network. The server does not encrypt its traffic, so the token and the screenshots cross that network as plain text.

The token keeps other accounts on the host, and web pages in your browser, from reading the taskset through the server. A web page can open a WebSocket to any port your browser can reach, but it cannot add the token to the request. Keep the token in a file that only your account can read.

Never bake a taskset or the token into an image: mount the taskset and pass the token when the container starts. A managed OpenEnv-compatible service can run the same image only if your team's training consent covers sending the data there.
