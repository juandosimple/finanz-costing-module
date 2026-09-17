#!/usr/bin/env python3
"""Numeric exam for the local models the app can use in step 5.

Twenty questions in four levels (basic, secondary, finance, PhD), each with a
single numeric answer, so grading is mechanical. Expected answers are computed
here rather than typed, and the model answers the way the app asks it to:
through Ollama with a forced JSON shape, with room to work before the number.

    python3 tools/model_exam.py --url http://192.168.0.250:11434 --model llama3.2:3b
"""

import argparse
import json
import math
import time
import urllib.request
from pathlib import Path

# (level, id, question, expected, tolerance)
QUESTIONS = [
    # Basic: multi-step arithmetic.
    ("basic", "B1", "A shop sells pens at 3 for 2 pounds. How many pounds do 18 pens cost?", 12, 0.01),
    ("basic", "B2", "A train leaves at 09:40 and arrives at 13:15 the same day. How many minutes is the trip?", 215, 0.01),
    ("basic", "B3", "Tom has 250 pounds. He spends 35% of it, then gives one fifth of what is left to his sister. How many pounds does he keep?", 250 * 0.65 * 0.8, 0.01),
    ("basic", "B4", "12 workers build a wall in 10 days. Working at the same rate, how many days do 15 workers need?", 12 * 10 / 15, 0.01),
    ("basic", "B5", "A recipe for 4 people needs 300 g of flour. How many grams are needed for 10 people?", 300 / 4 * 10, 0.01),
    # Secondary: algebra, percentages, geometry, sequences.
    ("secondary", "S1", "Solve for x: 3x - 7 = 2x + 11.", 18, 0.01),
    ("secondary", "S2", "A price rises 20% and then falls 20%. What is the net change in percent? Use a negative number for a decrease.", (1.2 * 0.8 - 1) * 100, 0.01),
    ("secondary", "S3", "What is the sum of the interior angles of a hexagon, in degrees?", 720, 0.01),
    ("secondary", "S4", "What is the larger root of x^2 - 5x + 6 = 0?", 3, 0.01),
    ("secondary", "S5", "A geometric sequence starts at 3 and each term doubles. What is the sum of the first 8 terms?", 3 * (2**8 - 1), 0.01),
    # Finance: the kind of figures step 5 reasons about.
    ("finance", "F1", "A platform has fixed costs of 81 per month, shared equally across 5 buildings, plus a cost of 1 per month for each building. What is the yearly cost of one building?", 81 * 12 / 5 + 12, 0.01),
    ("finance", "F2", "A building costs 206.40 a year to serve. A payment fee of 2.9% is taken from the price, and we want to keep a 35% margin on the price after costs and the fee. What yearly price must we charge? Round to 2 decimals.", 206.40 / (1 - 0.029 - 0.35), 0.5),
    ("finance", "F3", "A service has fixed costs of 972 per year. Each client building pays 120 per year and costs 12 per year to serve. What is the smallest whole number of buildings needed to not lose money?", math.ceil(972 / (120 - 12)), 0.01),
    ("finance", "F4", "An investment costs 10,000 today and returns 4,000 at the end of each of the next 3 years. At an 8% annual discount rate, what is its net present value? Round to 2 decimals.", sum(4000 / 1.08**t for t in (1, 2, 3)) - 10000, 1.0),
    ("finance", "F5", "5,000 is deposited at 6% annual interest compounded monthly. What is the balance after 2 years? Round to 2 decimals.", 5000 * (1 + 0.06 / 12) ** 24, 1.0),
    ("finance", "F6", "A hardware unit costs 2,000 and sells for 5,000. What is the profit margin as a percentage of the selling price?", (5000 - 2000) / 5000 * 100, 0.01),
    # PhD: calculus, linear algebra, probability, decay.
    ("phd", "P1", "Evaluate the definite integral of x * e^x from 0 to 1.", 1.0, 0.01),
    ("phd", "P2", "What is the largest eigenvalue of the matrix [[2, 1], [1, 2]]?", 3, 0.01),
    ("phd", "P3", "A disease affects 1% of people. A test detects it 99% of the time and gives a false positive 5% of the time. If a person tests positive, what is the probability, in percent, that they have the disease? Round to 2 decimals.", 0.01 * 0.99 / (0.01 * 0.99 + 0.99 * 0.05) * 100, 0.3),
    ("phd", "P4", "A substance has a half-life of 5,730 years. What percentage of it remains after 10,000 years? Round to 2 decimals.", 0.5 ** (10000 / 5730) * 100, 0.3),
]

SCHEMA = {
    "type": "object",
    "required": ["working", "answer"],
    "properties": {
        "working": {"type": "string", "description": "Your step-by-step calculation"},
        "answer": {"type": "number", "description": "The final numeric answer only"},
    },
}

SYSTEM = (
    "You solve maths and finance problems. Work step by step in `working`, "
    "then put only the final number in `answer`, with no units or symbols."
)


def ask(url: str, model: str, question: str) -> tuple[str, float | None, float]:
    body = json.dumps({
        "model": model,
        "stream": False,
        "format": SCHEMA,
        "options": {"temperature": 0},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": question},
        ],
    }).encode()
    request = urllib.request.Request(
        f"{url.rstrip('/')}/api/chat", data=body, headers={"Content-Type": "application/json"}
    )
    started = time.time()
    with urllib.request.urlopen(request, timeout=45 * 60) as response:
        content = json.load(response)["message"]["content"]
    elapsed = time.time() - started
    try:
        parsed = json.loads(content)
        return parsed.get("working", ""), float(parsed["answer"]), elapsed
    except (ValueError, KeyError, TypeError):
        return content, None, elapsed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://192.168.0.250:11434")
    parser.add_argument("--model", required=True)
    parser.add_argument("--out", default="tools/exam-results")
    args = parser.parse_args()

    results = []
    for level, qid, question, expected, tolerance in QUESTIONS:
        working, answer, elapsed = ask(args.url, args.model, question)
        correct = answer is not None and abs(answer - expected) <= tolerance
        results.append({
            "level": level, "id": qid, "question": question,
            "expected": round(expected, 4), "answer": answer,
            "correct": correct, "seconds": round(elapsed, 1), "working": working,
        })
        mark = "OK  " if correct else "FAIL"
        print(f"{mark} {qid}  expected {expected:.4g}  got {answer}  ({elapsed:.0f}s)", flush=True)

    levels = ["basic", "secondary", "finance", "phd"]
    summary = {}
    for level in levels:
        rows = [r for r in results if r["level"] == level]
        summary[level] = f"{sum(r['correct'] for r in rows)}/{len(rows)}"
    total = sum(r["correct"] for r in results)
    print(f"\n{args.model}: " + " · ".join(f"{k} {v}" for k, v in summary.items())
          + f" · total {total}/{len(results)}")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    name = args.model.replace(":", "-").replace("/", "-")
    (out / f"{name}.json").write_text(json.dumps(
        {"model": args.model, "url": args.url, "summary": summary, "total": total,
         "run_at": time.strftime("%Y-%m-%d %H:%M"), "results": results},
        indent=2,
    ))


if __name__ == "__main__":
    main()
