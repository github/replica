"""Measure the uniform baseline against a running brand check server.

    python examples/uniform_policy.py http://127.0.0.1:8000 \
        --allow-insecure-loopback --episodes 20

The script sends the server's token from REPLICA_ENV_TOKEN. Every question gets equal
probabilities over its options, and the script prints the mean reward.
"""

import argparse
import math

from replica_brand_check import BrandCheckAction, BrandCheckEnv, question_options


def uniform_answers(questions: dict) -> dict:
    """Return equal probabilities over the options of every question."""
    answers = {}
    for key, question in questions.items():
        options = question_options(question)
        answers[key] = {"probabilities": {option: 1 / len(options) for option in options}}
    return answers


def main() -> None:
    parser = argparse.ArgumentParser(description="Print the mean reward of uniform answers.")
    parser.add_argument("url", help="server URL, such as http://127.0.0.1:8000")
    parser.add_argument("--episodes", type=int, default=20, help="number of episodes to run")
    parser.add_argument(
        "--allow-insecure-loopback",
        action="store_true",
        help="send the token over plaintext loopback on a single-user machine",
    )
    args = parser.parse_args()
    if args.episodes < 1:
        parser.error("--episodes must be at least 1")
    try:
        client = BrandCheckEnv(
            base_url=args.url, allow_insecure_loopback=args.allow_insecure_loopback
        )
    except ValueError as error:
        parser.error(str(error))
    rewards = []
    with client.sync() as env:
        for episode in range(args.episodes):
            result = env.reset(seed=episode)
            answers = uniform_answers(result.observation.questions)
            rewards.append(env.step(BrandCheckAction(answers=answers)).reward)
    # On noul questions, 0.5 for yes earns exactly 1 - 0.5^2 = 0.75 whatever the label, so a
    # taskset with only noul labels averages 0.75. This is the baseline a trained model must beat.
    print(f"mean reward over {len(rewards)} episodes: {math.fsum(rewards) / len(rewards)}")


if __name__ == "__main__":
    main()
