#!/usr/bin/env python3
"""Post a summary of the Replica feedback survey to GitHub Discussions.

Only totals are published. Written answers, names, emails, and contact
preferences are never read into the post.

Environment:
  ALCHEMER_API_TOKEN, ALCHEMER_API_SECRET  Alchemer v5 API key and secret
  SURVEY_ID          Alchemer survey id (default 9055055)
  MIN_RESPONSES      skip posting below this many complete responses (default 10)
  PERIOD_DAYS        length of the "new since last post" window (default 14)
  GITHUB_TOKEN       token with discussions: write
  GITHUB_REPOSITORY  owner/name
  DISCUSSION_CATEGORY  category slug (default announcements)
  DRY_RUN            "true" prints the post instead of creating it
  FIXTURE            path to a JSON file of responses, for testing without the API
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone

API_BASE = os.environ.get("ALCHEMER_API_BASE", "https://api.alchemer.com/v5")
SURVEY_ID = os.environ.get("SURVEY_ID", "9055055")
MIN_RESPONSES = int(os.environ.get("MIN_RESPONSES", "10"))
PERIOD_DAYS = int(os.environ.get("PERIOD_DAYS", "14"))
SURVEY_LINK = "https://gh.io/replica-feedback"

# Question ids in survey 9055055. Only these are read; everything else
# (written answers, contact consent, name, email) is ignored.
Q_USED = "120"
Q_SETUP_TABLE = "151"
Q_SETUP_STEPS = ["152", "153", "154", "155", "156", "157", "158", "159"]
Q_WORK = "174"
Q_USEFUL = "175"

HARD = {"Very hard", "Hard"}
EASY = {"Easy", "Very easy"}
NOT_DONE = "Did not do this"
NOT_ENOUGH = "Haven't used it enough to rate"


def clean(text) -> str:
    if isinstance(text, dict):
        text = text.get("English") or next(iter(text.values()), "")
    text = html.unescape(re.sub(r"<[^>]+>", "", str(text or "")))
    return text.replace("\u2019", "'").strip()


def alchemer_get(path: str, params: dict | None = None) -> dict:
    query = {
        "api_token": os.environ["ALCHEMER_API_TOKEN"],
        "api_token_secret": os.environ["ALCHEMER_API_SECRET"],
        **(params or {}),
    }
    url = f"{API_BASE}/{path}?{urllib.parse.urlencode(query)}"
    with urllib.request.urlopen(url, timeout=60) as resp:
        data = json.load(resp)
    if data.get("result_ok") is False:
        raise RuntimeError(f"Alchemer API error on {path}: {data.get('message')}")
    return data


def alchemer_all(path: str, params: dict | None = None) -> list[dict]:
    out, page = [], 1
    while True:
        data = alchemer_get(path, {**(params or {}), "resultsperpage": 500, "page": page})
        rows = data.get("data") or []
        out.extend(rows)
        if page >= int(data.get("total_pages") or 1) or not rows:
            return out
        page += 1


def load_data() -> tuple[dict[str, str], list[dict]]:
    fixture = os.environ.get("FIXTURE")
    if fixture:
        with open(fixture) as f:
            data = json.load(f)
        return data["questions"], data["responses"]
    questions = {
        str(q["id"]): clean(q.get("title"))
        for q in alchemer_all(f"survey/{SURVEY_ID}/surveyquestion")
    }
    responses = alchemer_all(
        f"survey/{SURVEY_ID}/surveyresponse",
        {
            "filter[field][0]": "status",
            "filter[operator][0]": "=",
            "filter[value][0]": "Complete",
        },
    )
    return questions, responses


def is_real(resp: dict) -> bool:
    return resp.get("status") == "Complete" and str(resp.get("is_test_data", "0")) != "1"


def submitted(resp: dict) -> datetime | None:
    raw = str(resp.get("date_submitted") or resp.get("datesubmitted") or "")[:19]
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def picked(entry: dict | None) -> list[str]:
    if not isinstance(entry, dict):
        return []
    options = entry.get("options")
    if isinstance(options, dict) and options:
        return [clean(o.get("answer") or o.get("option")) for o in options.values() if o]
    answer = clean(entry.get("answer"))
    return [answer] if answer else []


def setup_answer(data: dict, qid: str) -> str:
    if isinstance(data.get(qid), dict):
        values = picked(data[qid])
        if values:
            return values[0]
    table = data.get(Q_SETUP_TABLE) or {}
    sub = (table.get("subquestions") or {}).get(qid)
    return clean(sub.get("answer")) if isinstance(sub, dict) else ""


def pct(n: int, total: int) -> str:
    return f"{round(100 * n / total)}%" if total else "0%"


def build_post(questions: dict[str, str], responses: list[dict], now: datetime) -> tuple[str, str] | None:
    real = [r for r in responses if is_real(r)]
    total = len(real)
    if total < MIN_RESPONSES:
        print(f"Only {total} complete responses (minimum {MIN_RESPONSES}). Not posting.")
        return None

    since = now - timedelta(days=PERIOD_DAYS)
    new = sum(1 for r in real if (submitted(r) or now) >= since)

    used, work, useful = Counter(), Counter(), Counter()
    setup = {qid: Counter() for qid in Q_SETUP_STEPS}
    for r in real:
        data = r.get("survey_data") or {}
        used.update(picked(data.get(Q_USED)))
        work.update(picked(data.get(Q_WORK)))
        useful.update(picked(data.get(Q_USEFUL)))
        for qid in Q_SETUP_STEPS:
            answer = setup_answer(data, qid)
            if answer:
                setup[qid][answer] += 1

    date = now.strftime("%b %-d, %Y")
    lines = [
        f"Here's what people have told us so far in the [Replica feedback survey]({SURVEY_LINK}). "
        f"Thank you to everyone who answered.",
        "",
        f"- **Complete responses:** {total} ({new} in the last {PERIOD_DAYS} days)",
    ]

    scores = {str(s): useful.get(str(s), 0) for s in range(6)}
    rated = sum(scores.values())
    if rated:
        avg = sum(int(s) * n for s, n in scores.items()) / rated
        top = scores["4"] + scores["5"]
        lines.append(
            f"- **Usefulness:** {avg:.1f} out of 5 on average. "
            f"{top} of {rated} ({pct(top, rated)}) rated it 4 or 5."
        )
    if useful.get(NOT_ENOUGH):
        lines.append(f"- **Not used enough to rate yet:** {useful[NOT_ENOUGH]}")

    lines += ["", "## How people have used Replica", "", "| Answer | People | Share |", "| --- | ---: | ---: |"]
    for answer, n in used.most_common():
        lines.append(f"| {answer} | {n} | {pct(n, total)} |")

    lines += [
        "",
        "## How setup went",
        "",
        "Counts only include people who did that step.",
        "",
        "| Step | Hard or very hard | Neither | Easy or very easy | People |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    rows = []
    for qid in Q_SETUP_STEPS:
        c = setup[qid]
        did = sum(n for a, n in c.items() if a != NOT_DONE)
        if not did:
            continue
        hard = sum(c[a] for a in HARD)
        easy = sum(c[a] for a in EASY)
        rows.append((hard / did, f"| {questions.get(qid, qid)} | {hard} ({pct(hard, did)}) | {did - hard - easy} | {easy} ({pct(easy, did)}) | {did} |"))
    for _, row in sorted(rows, key=lambda x: -x[0]):
        lines.append(row)

    lines += ["", "## What people are prototyping", "", "| Kind of work | People | Share |", "| --- | ---: | ---: |"]
    for answer, n in work.most_common():
        lines.append(f"| {answer} | {n} | {pct(n, total)} |")

    lines += [
        "",
        "## Usefulness scores",
        "",
        "| Score | " + " | ".join(str(s) for s in range(6)) + " |",
        "| --- |" + " ---: |" * 6,
        "| People | " + " | ".join(str(scores[str(s)]) for s in range(6)) + " |",
        "",
        "---",
        "",
        f"Tried Replica? [Share your experience]({SURVEY_LINK}). "
        "These numbers are totals only. Written answers and contact details stay private to the Replica team. "
        f"This post is created automatically every two weeks once there are at least {MIN_RESPONSES} responses.",
    ]
    return f"Replica feedback survey: results through {date}", "\n".join(lines) + "\n"


def graphql(query: str, variables: dict) -> dict:
    req = urllib.request.Request(
        "https://api.github.com/graphql",
        data=json.dumps({"query": query, "variables": variables}).encode(),
        headers={
            "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    if data.get("errors"):
        raise RuntimeError(json.dumps(data["errors"]))
    return data["data"]


def post_discussion(title: str, body: str) -> str:
    owner, name = os.environ["GITHUB_REPOSITORY"].split("/")
    slug = os.environ.get("DISCUSSION_CATEGORY", "announcements")
    repo = graphql(
        """query($owner:String!,$name:String!){repository(owner:$owner,name:$name){
             id discussionCategories(first:50){nodes{id slug}}}}""",
        {"owner": owner, "name": name},
    )["repository"]
    category = next((c["id"] for c in repo["discussionCategories"]["nodes"] if c["slug"] == slug), None)
    if not category:
        raise RuntimeError(f"No discussion category with slug '{slug}'")
    result = graphql(
        """mutation($repo:ID!,$cat:ID!,$title:String!,$body:String!){
             createDiscussion(input:{repositoryId:$repo,categoryId:$cat,title:$title,body:$body}){
               discussion{url}}}""",
        {"repo": repo["id"], "cat": category, "title": title, "body": body},
    )
    return result["createDiscussion"]["discussion"]["url"]


def main() -> int:
    questions, responses = load_data()
    post = build_post(questions, responses, datetime.now(timezone.utc))
    if post is None:
        return 0
    title, body = post
    if os.environ.get("DRY_RUN", "").lower() == "true":
        print(f"# {title}\n\n{body}")
        return 0
    print(f"Created {post_discussion(title, body)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
