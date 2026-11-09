"""Train d1-omni-600M against the brand check environment.

Liquid AI's d1-omni-600M answers typed questions about images with probabilities. This trainer
keeps the released model frozen and trains one small part with reinforcement learning from the
environment's rewards. It learns from the scores alone and never reads the labels.

`--part readout`, the default, adds a linear readout of 1,025 numbers. It reads the trunk's
states at each yes-or-no question's answer options and adds a correction to the released model's
answer. It starts at zero, so training starts from the released model. `--part head` trains the
whole decision head instead, about 26 million of the model's 587 million parameters. On our
synthetic taskset of 518 practice pages, the head memorized the practice pages and never beat
answering 50% on new ones, while the readout improved on pages it never practiced on.

    python examples/train_d1_omni.py train --model DIR --taskset DIR --out runs/demo
    python examples/train_d1_omni.py evaluate --model DIR --taskset DIR \
        --trained runs/demo/best.pt --split test --out runs/demo

Both commands talk to a running server through `--url` and send the token from
REPLICA_ENV_TOKEN. They read `--taskset` only to list the dev or test tasks; the server scores
every answer. Install torch, transformers 5.14 or later, and pillow next to this package, and
download the model first:

    hf download LiquidAI/d1-omni-600M \
        --revision 02b55d7076f15129e59ab3f94783f32c4b088674 --local-dir DIR

The model runs its own code from that folder (`trust_remote_code`), so review it first.

How training works: for each task, the policy reads the screenshots once. For every yes-or-no
question it then tries a small group of answers, its own probability of yes nudged by random
noise. The environment scores each answer with its proper scoring rule, and the policy moves
toward the answers that scored above their group's average. This is a group-relative policy
gradient (REINFORCE with a group baseline). Every `--eval-every` updates it scores the dev split
and keeps the weights with the best dev reward, because a small taskset is easy to memorize.
Report the test split once, with the weights you chose on dev.

The readout first reads every practice page once, to scale each of its inputs by that input's
mean and spread over the practice pages. This uses no labels, and the pages stay cached for
training.
"""

from __future__ import annotations

import argparse
import base64
import importlib
import io
import json
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
import torch.nn.functional as F
from PIL import Image
from replica_brand_check import BrandCheckAction, BrandCheckEnv
from replica_brand_check.evaluate import evaluate
from replica_brand_check.taskset import load_taskset
from torch.nn.utils.rnn import pad_sequence
from transformers import AutoModel


@dataclass
class Features:
    """The frozen trunk's output for each yes-or-no question of one task.

    The head reads `texts` and `markers`. The readout reads only `released`, the released head's
    logits, and `pooled`, the trunk's mean state at each question's answer options, so it keeps
    those and drops the rest.
    """

    keys: list[str]
    texts: list[torch.Tensor]
    markers: list[list[int]]
    released: torch.Tensor | None = None
    pooled: torch.Tensor | None = None


def decode_image(uri: str) -> Image.Image:
    header, data = uri.split(",", 1)
    if not header.startswith("data:image/") or not header.endswith(";base64"):
        raise ValueError("expected a base64 image data URI")
    return Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")


def rotate_half(x: torch.Tensor) -> torch.Tensor:
    x1, x2 = x.chunk(2, dim=-1)
    return torch.cat((-x2, x1), dim=-1)


class Policy:
    """d1-omni-600M with one trainable part and a per-task cache of the frozen trunk."""

    def __init__(self, model_dir: str, part: str = "readout"):
        self.device = (
            "mps"
            if torch.backends.mps.is_available()
            else "cuda"
            if torch.cuda.is_available()
            else "cpu"
        )
        # The model card asks for float32; its probability readout is unstable in bfloat16.
        self.model = AutoModel.from_pretrained(
            model_dir, trust_remote_code=True, dtype=torch.float32
        )
        self.model.to(self.device).eval()
        for parameter in self.model.parameters():
            parameter.requires_grad_(False)
        for parameter in self.model.head.parameters():
            parameter.requires_grad_(part == "head")
        self.part = part
        width = self.model.encoder.embed_tokens.weight.shape[1]
        self.readout = torch.nn.Linear(width, 1).to(self.device)
        torch.nn.init.zeros_(self.readout.weight)
        torch.nn.init.zeros_(self.readout.bias)
        self.mean = torch.zeros(width, device=self.device)
        self.std = torch.ones(width, device=self.device)
        package = type(self.model).__module__.rsplit(".", 1)[0]
        prompt = importlib.import_module(f"{package}.prompt")
        modeling = importlib.import_module(type(self.model).__module__)
        self._encode, self._as_question = prompt.encode, prompt.as_question
        self._noul_type = prompt.QTYPES["noul"]
        self._yes_no = modeling.YES_NO
        self.cache: dict[str, Features] = {}

    def parameters(self) -> list[torch.nn.Parameter]:
        part = self.model.head if self.part == "head" else self.readout
        return list(part.parameters())

    def state(self) -> dict[str, Any]:
        part = self.model.head if self.part == "head" else self.readout
        weights = {name: value.detach().cpu().clone() for name, value in part.state_dict().items()}
        state = {"part": self.part, "weights": weights}
        if self.part == "readout":
            state.update(mean=self.mean.cpu(), std=self.std.cpu())
        return state

    def load(self, state: dict[str, Any]) -> None:
        if state["part"] != self.part:
            raise ValueError(f"expected a trained {self.part}, not a {state['part']}")
        part = self.model.head if self.part == "head" else self.readout
        part.load_state_dict(state["weights"])
        if self.part == "readout":
            self.mean, self.std = state["mean"].to(self.device), state["std"].to(self.device)

    def fit_scale(self, env, task_ids: list[str]) -> None:
        """Scale the readout's inputs by their mean and spread over the given tasks."""
        rows = []
        for count, task_id in enumerate(task_ids, 1):
            rows.append(self.observe(env, task_id).pooled)
            if count % 50 == 0 or count == len(task_ids):
                print(f"read {count} of {len(task_ids)} practice pages", flush=True)
        pooled = torch.cat(rows)
        self.mean, self.std = pooled.mean(0), pooled.std(0) + 1e-6

    @torch.no_grad()
    def features(
        self, task_id: str, state: Any, images: list[str], questions: dict[str, Any]
    ) -> Features:
        """Run the screenshots through the trunk once, then each yes-or-no question's text.

        The image prefix never reads the text, so its states are the same for every question.
        Keeping each attention layer's image keys and values, and each convolution's last image
        input, gives the same result as running the whole sequence once per question.
        """
        if task_id in self.cache:
            return self.cache[task_id]
        model, trunk = self.model, self.model.encoder
        prefix = model.vision([decode_image(uri) for uri in images])
        m = prefix.shape[1]
        max_len = min(model.config.image_text_length, model.config.max_length - m)
        keys = [key for key, question in questions.items() if question.get("type") == "noul"]
        # d1 learned image questions with plain yes and no options, so the criteria are not sent.
        rows = [
            self._encode(
                model.tokenizer,
                state,
                self._as_question(
                    {
                        "type": "noul",
                        "instructions": questions[key]["instructions"],
                        "criteria": None,
                    }
                ),
                max_len,
                self._yes_no,
                False,
            )
            for key in keys
        ]

        h = prefix.to(trunk.embed_tokens.weight.dtype)
        mask = torch.zeros(1, 1, m, m, device=self.device, dtype=h.dtype)
        keep_right = (torch.arange(m, device=self.device)[None] != m - 1).to(h.dtype)
        ones = torch.ones(1, m, device=self.device, dtype=h.dtype)
        cos, sin = trunk.rope(m, h)
        media_k, media_v, last = {}, {}, {}
        for index, layer in enumerate(trunk.layers):
            x = layer.operator_norm(h)
            if layer.is_attention_layer:
                attn = layer.self_attn
                k = attn.k_layernorm(attn.k_proj(x).view(1, m, -1, attn.head_dim)).transpose(1, 2)
                media_k[index] = (k * cos + rotate_half(k) * sin)[0]
                media_v[index] = attn.v_proj(x).view(1, m, -1, attn.head_dim).transpose(1, 2)[0]
                x = attn(x, cos, sin, mask)
            else:
                b, _, u = layer.conv.in_proj(x[0, m - 1]).chunk(3)
                last[index] = b * u
                x = layer.conv(x, ones, keep_right)
            h = h + x
            h = h + layer.feed_forward(layer.ffn_norm(h))

        h = pad_sequence(
            [trunk.embed_tokens(torch.tensor(ids, device=self.device)) for ids, _ in rows],
            batch_first=True,
        )
        count, length, _ = h.shape
        lengths = torch.tensor([len(ids) for ids, _ in rows], device=self.device)
        real = torch.arange(length, device=self.device)[None] < lengths[:, None]
        realf = real.to(h.dtype)
        cos, sin = trunk.rope(m + length, h)
        cos, sin = cos[:, :, m:], sin[:, :, m:]
        neg = max(-1e9, torch.finfo(h.dtype).min)
        key_mask = torch.cat(
            [torch.zeros(count, m, device=self.device, dtype=h.dtype), ((~real).to(h.dtype) * neg)],
            dim=1,
        )[:, None, None, :]
        for index, layer in enumerate(trunk.layers):
            x = layer.operator_norm(h)
            if layer.is_attention_layer:
                attn = layer.self_attn
                shape = (count, length, -1, attn.head_dim)
                q = attn.q_layernorm(attn.q_proj(x).view(shape)).transpose(1, 2)
                k = attn.k_layernorm(attn.k_proj(x).view(shape)).transpose(1, 2)
                v = attn.v_proj(x).view(shape).transpose(1, 2)
                q, k = q * cos + rotate_half(q) * sin, k * cos + rotate_half(k) * sin
                k = torch.cat([media_k[index][None].expand(count, -1, -1, -1), k], dim=2)
                v = torch.cat([media_v[index][None].expand(count, -1, -1, -1), v], dim=2)
                groups = attn.heads // attn.kv_heads
                k, v = k.repeat_interleave(groups, dim=1), v.repeat_interleave(groups, dim=1)
                y = F.scaled_dot_product_attention(
                    q, k, v, attn_mask=key_mask, scale=attn.head_dim**-0.5
                )
                x = attn.out_proj(y.transpose(1, 2).reshape(count, length, -1))
            else:
                conv = layer.conv
                b, c, u = conv.in_proj(x * realf[:, :, None]).transpose(-1, -2).chunk(3, dim=-2)
                bx = b * u
                left = last[index][None, :, None].expand(count, -1, 1)
                padded = torch.cat([left, bx, torch.zeros_like(left)], dim=-1)
                w = conv.conv.weight[:, 0, :]
                y = sum(padded[..., i : i + length] * w[:, i, None] for i in range(3))
                x = conv.out_proj((c * y).transpose(-1, -2))
            h = h + x
            h = h + layer.feed_forward(layer.ffn_norm(h))
        h = trunk.embedding_norm(h)
        features = Features(
            keys,
            [h[i, : len(ids)].clone() for i, (ids, _) in enumerate(rows)],
            [m for _, m in rows],
        )
        if self.part == "readout":
            features = Features(
                keys,
                [],
                [],
                self.head_logits(features),
                torch.stack([t[m].mean(0) for t, m in zip(features.texts, features.markers)]),
            )
        self.cache[task_id] = features
        return features

    def yes_logits(self, features: Features, keys: list[str] | None = None) -> torch.Tensor:
        """The logit of yes for each named question; differentiable in the trained part."""
        chosen = [features.keys.index(key) for key in (keys or features.keys)]
        if self.part == "head":
            return self.head_logits(features, chosen)
        x = (features.pooled[chosen] - self.mean) / self.std
        return features.released[chosen] + self.readout(x).squeeze(-1)

    def head_logits(self, features: Features, chosen: list[int] | None = None) -> torch.Tensor:
        """The head's logit of yes for each chosen question."""
        chosen = list(range(len(features.keys))) if chosen is None else chosen
        texts = [features.texts[i] for i in chosen]
        text = pad_sequence(texts, batch_first=True)
        lengths = torch.tensor([len(t) for t in texts], device=self.device)
        text_pad = torch.arange(text.shape[1], device=self.device)[None] < lengths[:, None]
        markers = torch.tensor([features.markers[i] for i in chosen], device=self.device)
        qtype = torch.full((len(chosen),), self._noul_type, device=self.device)
        z = self.model.head(
            text, text_pad, markers, torch.ones_like(markers, dtype=torch.bool), qtype
        )
        return z[:, 1] - z[:, 0]  # the head reads a yes-or-no question as [false, true]

    @torch.no_grad()
    def answers(self, features: Features) -> dict[str, dict[str, dict[str, float]]]:
        yes = torch.sigmoid(self.yes_logits(features)).tolist()
        return {
            key: {"probabilities": {"yes": p, "no": 1.0 - p}} for key, p in zip(features.keys, yes)
        }

    def observe(self, env, task_id: str) -> Features:
        observation = env.reset(task_id=task_id).observation
        return self.features(task_id, observation.state, observation.images, observation.questions)


def split_reward(policy: Policy, env, task_ids: list[str]) -> tuple[float, dict]:
    """The mean reward of the policy's own answers over a split, as the environment scores them."""
    total, predictions = 0.0, {}
    for task_id in task_ids:
        features = policy.observe(env, task_id)
        predictions[task_id] = policy.answers(features)
        total += env.step(BrandCheckAction(answers=predictions[task_id])).reward
    return total / len(task_ids), predictions


def train(args: argparse.Namespace) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(args.seed)
    rng = random.Random(args.seed)
    policy = Policy(args.model, args.part)
    lr, decay = {"readout": (3e-3, 0.1), "head": (3e-5, 0.05)}[args.part]
    optimizer = torch.optim.AdamW(
        policy.parameters(),
        lr=lr if args.lr is None else args.lr,
        weight_decay=decay if args.weight_decay is None else args.weight_decay,
    )
    taskset = load_taskset(args.taskset)
    dev_ids = [task.id for task in taskset.by_split["dev"]]
    log = (out / "train.jsonl").open("w", encoding="utf-8")
    started = time.time()
    with BrandCheckEnv(base_url=args.url).sync() as env:
        if args.part == "readout":
            policy.fit_scale(env, [task.id for task in taskset.by_split["train"]])
        best, _ = split_reward(policy, env, dev_ids)
        torch.save(policy.state(), out / "best.pt")
        log.write(json.dumps({"update": 0, "devReward": best}) + "\n")
        print(f"dev reward before training: {best:.4f}", flush=True)
        for update in range(1, args.updates + 1):
            sigma = args.sigma + (args.sigma_final - args.sigma) * (update - 1) / max(
                1, args.updates - 1
            )
            optimizer.zero_grad()
            sampled = []
            for _ in range(args.tasks_per_update):
                observation = env.reset(split="train", seed=rng.randrange(2**31)).observation
                features = policy.features(
                    observation.task_id,
                    observation.state,
                    observation.images,
                    observation.questions,
                )
                with torch.no_grad():
                    mu = policy.yes_logits(features)
                noise = torch.randn(args.group, len(features.keys), device=mu.device)
                yes = torch.sigmoid(mu + sigma * noise)
                rewards = []
                for k in range(args.group):
                    if k:
                        env.reset(task_id=observation.task_id)
                    answers = {
                        key: {"probabilities": {"yes": p, "no": 1 - p}}
                        for key, p in zip(features.keys, yes[k].tolist())
                    }
                    rewards.append(env.step(BrandCheckAction(answers=answers)).observation.rewards)
                labeled = [key for key in features.keys if key in rewards[0]]
                if not labeled:
                    continue
                columns = [features.keys.index(key) for key in labeled]
                r = torch.tensor(
                    [[row[key] for key in labeled] for row in rewards], device=mu.device
                )
                advantage = r - r.mean(0, keepdim=True)
                direction = (advantage * noise[:, columns]).mean(0) / sigma
                surrogate = (direction * policy.yes_logits(features, labeled)).sum()
                (-surrogate / args.tasks_per_update).backward()
                sampled.append(r.mean().item())
            torch.nn.utils.clip_grad_norm_(policy.parameters(), 1.0)
            optimizer.step()
            entry = {
                "update": update,
                "sigma": round(sigma, 4),
                "sampledReward": sum(sampled) / max(1, len(sampled)),
                "seconds": round(time.time() - started, 1),
            }
            if update % args.eval_every == 0:
                entry["devReward"], _ = split_reward(policy, env, dev_ids)
                if entry["devReward"] > best:
                    best = entry["devReward"]
                    torch.save(policy.state(), out / "best.pt")
                print(json.dumps(entry), flush=True)
            log.write(json.dumps(entry) + "\n")
            log.flush()
    torch.save(policy.state(), out / "last.pt")
    print(f"best dev reward {best:.4f}; saved {out / 'best.pt'}")


def run_evaluate(args: argparse.Namespace) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    taskset = load_taskset(args.taskset)
    state = torch.load(args.trained, map_location="cpu") if args.trained else None
    policy = Policy(args.model, state["part"] if state else "head")
    if state:
        policy.load(state)
    with BrandCheckEnv(base_url=args.url).sync() as env:
        reward, predictions = split_reward(
            policy, env, [task.id for task in taskset.by_split[args.split]]
        )
    name = f"{args.name}-{args.split}"
    with (out / f"{name}-predictions.jsonl").open("w", encoding="utf-8") as handle:
        for task_id, answers in predictions.items():
            handle.write(json.dumps({"taskId": task_id, "answers": answers}) + "\n")
    report = evaluate(taskset, predictions, args.split)
    (out / f"{name}-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    noul = report["noul"]
    print(
        json.dumps(
            {
                "split": args.split,
                "tasks": report["tasks"],
                "meanReward": report["meanReward"],
                "environmentReward": reward,
                "accuracy": noul["accuracy"],
                "balancedAccuracy": noul["balancedAccuracy"],
                "ece": noul["ece"],
            }
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("train", "evaluate"):
        command = commands.add_parser(name)
        command.add_argument("--url", default="http://127.0.0.1:8000")
        command.add_argument("--model", required=True, help="folder holding LiquidAI/d1-omni-600M")
        command.add_argument(
            "--taskset", required=True, help="taskset folder, to list the dev or test tasks"
        )
        command.add_argument(
            "--out", required=True, help="folder for the log, heads, predictions, and reports"
        )
    training = commands.choices["train"]
    training.add_argument("--part", choices=["readout", "head"], default="readout")
    training.add_argument("--updates", type=int, default=600)
    training.add_argument("--tasks-per-update", type=int, default=16)
    training.add_argument("--group", type=int, default=8, help="answers tried per task")
    training.add_argument(
        "--sigma", type=float, default=1.0, help="exploration noise in logit space, at the start"
    )
    training.add_argument("--sigma-final", type=float, default=0.4)
    training.add_argument("--lr", type=float, help="3e-3 for the readout, 3e-5 for the head")
    training.add_argument(
        "--weight-decay", type=float, help="0.1 for the readout, 0.05 for the head"
    )
    training.add_argument("--eval-every", type=int, default=10)
    training.add_argument("--seed", type=int, default=7)
    evaluating = commands.choices["evaluate"]
    evaluating.add_argument("--trained", help="trained weights; the released model when omitted")
    evaluating.add_argument("--split", default="test", choices=["train", "dev", "test"])
    evaluating.add_argument("--name", default="d1-omni")
    args = parser.parse_args()
    if args.command == "train":
        train(args)
    else:
        run_evaluate(args)


if __name__ == "__main__":
    main()
