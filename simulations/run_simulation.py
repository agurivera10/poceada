from __future__ import annotations

import argparse
import hashlib
import json
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

ENGINE_VERSION = "SIM_ENGINE_V1"
UNIVERSE = 100
DRAW_SIZE = 10

K6_EDGE_15 = np.array([
    [0, 1, 2, 3, 4],
    [0, 5, 6, 7, 8],
    [1, 8, 9, 10, 11],
    [2, 7, 9, 12, 13],
    [4, 6, 11, 12, 14],
    [3, 5, 10, 13, 14],
], dtype=np.int16)

WHEEL_6 = np.array([
    [1, 2, 3, 4, 5],
    [0, 2, 3, 4, 5],
    [0, 1, 3, 4, 5],
    [0, 1, 2, 4, 5],
    [0, 1, 2, 3, 5],
    [0, 1, 2, 3, 4],
], dtype=np.int16)

DISJOINT_6 = np.arange(30, dtype=np.int16).reshape(6, 5)


def hist_update(target: Counter, values: np.ndarray) -> None:
    unique, counts = np.unique(values, return_counts=True)
    for value, count in zip(unique.tolist(), counts.tolist()):
        target[str(int(value))] += int(count)


def generate_draws(rng: np.random.Generator, n: int) -> np.ndarray:
    scores = rng.random((n, UNIVERSE), dtype=np.float32)
    return np.argpartition(scores, DRAW_SIZE - 1, axis=1)[:, :DRAW_SIZE].astype(np.int16)


def draws_to_presence(draws: np.ndarray) -> np.ndarray:
    presence = np.zeros((draws.shape[0], UNIVERSE), dtype=np.bool_)
    rows = np.arange(draws.shape[0])[:, None]
    presence[rows, draws] = True
    return presence


def eval_portfolio(presence: np.ndarray, tickets: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    hits = presence[:, tickets].sum(axis=2)
    return hits, hits.max(axis=1)


def simulate_portfolio_geometry(rng: np.random.Generator, iterations: int, batch_size: int) -> dict:
    portfolios = {
        "k6_edge_15": K6_EDGE_15,
        "wheel_6": WHEEL_6,
        "disjoint_6": DISJOINT_6,
    }
    counters = defaultdict(Counter)
    histograms = defaultdict(Counter)
    done = 0
    while done < iterations:
        n = min(batch_size, iterations - done)
        presence = draws_to_presence(generate_draws(rng, n))
        for name, tickets in portfolios.items():
            hits, max_hits = eval_portfolio(presence, tickets)
            counters[name]["at_least_3"] += int(np.count_nonzero(max_hits >= 3))
            counters[name]["at_least_4"] += int(np.count_nonzero(max_hits >= 4))
            counters[name]["at_least_5"] += int(np.count_nonzero(max_hits >= 5))
            counters[name]["multiple_4plus"] += int(np.count_nonzero((hits >= 4).sum(axis=1) >= 2))
            counters[name]["tickets_4plus"] += int(np.count_nonzero(hits >= 4))
            hist_update(histograms[f"{name}.max_hits"], max_hits)
        done += n
    return {
        "counters": {k: dict(v) for k, v in counters.items()},
        "histograms": {k: dict(v) for k, v in histograms.items()},
    }


def simulate_selection_shadow(rng: np.random.Generator, iterations: int, batch_size: int) -> dict:
    pool_hist = Counter()
    max_hist = Counter()
    counters = Counter()
    done = 0
    while done < iterations:
        n = min(batch_size, iterations - done)
        pool_scores = rng.random((n, UNIVERSE), dtype=np.float32)
        pools = np.argpartition(pool_scores, 14, axis=1)[:, :15].astype(np.int16)
        draws = generate_draws(rng, n)
        draw_presence = draws_to_presence(draws)
        rows = np.arange(n)[:, None]
        pool_hits = draw_presence[rows, pools].sum(axis=1)
        ticket_numbers = pools[:, K6_EDGE_15]
        ticket_rows = np.arange(n)[:, None, None]
        ticket_hits = draw_presence[ticket_rows, ticket_numbers].sum(axis=2)
        max_hits = ticket_hits.max(axis=1)
        hist_update(pool_hist, pool_hits)
        hist_update(max_hist, max_hits)
        counters["at_least_3"] += int(np.count_nonzero(max_hits >= 3))
        counters["at_least_4"] += int(np.count_nonzero(max_hits >= 4))
        counters["at_least_5"] += int(np.count_nonzero(max_hits >= 5))
        done += n
    return {
        "counters": {"selection_shadow": dict(counters)},
        "histograms": {
            "selection_shadow.pool_hits": dict(pool_hist),
            "selection_shadow.max_hits": dict(max_hist),
        },
    }


def simulate_null_seasons(rng: np.random.Generator, seasons: int, batch_seasons: int, draws_per_season: int) -> dict:
    h_freq = Counter()
    h_delay = Counter()
    h_streak = Counter()
    done = 0
    while done < seasons:
        b = min(batch_seasons, seasons - done)
        flat_draws = generate_draws(rng, b * draws_per_season)
        flat_presence = draws_to_presence(flat_draws)
        presence = flat_presence.reshape(b, draws_per_season, UNIVERSE)

        freq = presence.sum(axis=1)
        max_frequency = freq.max(axis=1)

        current_absence = np.zeros((b, UNIVERSE), dtype=np.int16)
        max_absence = np.zeros((b, UNIVERSE), dtype=np.int16)
        current_streak = np.zeros((b, UNIVERSE), dtype=np.int16)
        max_streak = np.zeros((b, UNIVERSE), dtype=np.int16)
        for t in range(draws_per_season):
            hit = presence[:, t, :]
            current_streak = np.where(hit, current_streak + 1, 0)
            max_streak = np.maximum(max_streak, current_streak)
            current_absence = np.where(hit, 0, current_absence + 1)
            max_absence = np.maximum(max_absence, current_absence)

        hist_update(h_freq, max_frequency)
        hist_update(h_delay, max_absence.max(axis=1))
        hist_update(h_streak, max_streak.max(axis=1))
        done += b

    return {
        "counters": {},
        "histograms": {
            "null_season.max_frequency": dict(h_freq),
            "null_season.max_delay": dict(h_delay),
            "null_season.max_streak": dict(h_streak),
        },
    }


def top_k_indices(values: np.ndarray, k: int, largest: bool = True) -> np.ndarray:
    work = -values if largest else values
    return np.argpartition(work, k - 1, axis=1)[:, :k]


def simulate_multiple_testing(rng: np.random.Generator, seasons: int, batch_seasons: int, train_draws: int = 267) -> dict:
    best_hist = Counter()
    model_hists: dict[str, Counter] = {name: Counter() for name in ["frequency", "last30", "last10", "delay", "cold"]}
    done = 0
    while done < seasons:
        b = min(batch_seasons, seasons - done)
        flat_draws = generate_draws(rng, b * (train_draws + 1))
        presence = draws_to_presence(flat_draws).reshape(b, train_draws + 1, UNIVERSE)
        train = presence[:, :train_draws, :]
        test = presence[:, train_draws, :]

        frequency = train.sum(axis=1)
        last30 = train[:, -30:, :].sum(axis=1)
        last10 = train[:, -10:, :].sum(axis=1)
        reverse = train[:, ::-1, :]
        delay = np.where(reverse.any(axis=1), np.argmax(reverse, axis=1), train_draws)

        models = {
            "frequency": top_k_indices(frequency, 20, True),
            "last30": top_k_indices(last30, 20, True),
            "last10": top_k_indices(last10, 20, True),
            "delay": top_k_indices(delay, 20, True),
            "cold": top_k_indices(frequency, 20, False),
        }
        model_hits = []
        rows = np.arange(b)[:, None]
        for name, top20 in models.items():
            hits = test[rows, top20].sum(axis=1)
            hist_update(model_hists[name], hits)
            model_hits.append(hits)
        best = np.stack(model_hits, axis=1).max(axis=1)
        hist_update(best_hist, best)
        done += b

    histograms = {f"redteam.{k}.top20_hits": dict(v) for k, v in model_hists.items()}
    histograms["redteam.best_of_5.top20_hits"] = dict(best_hist)
    return {"counters": {}, "histograms": histograms}


def shard_iterations(total: int, shard_index: int, shard_count: int) -> int:
    base, extra = divmod(total, shard_count)
    return base + (1 if shard_index < extra else 0)


def canonical_hash(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preset", required=True, choices=[
        "portfolio-null-geometry-v1",
        "selection-shadow-v1",
        "null-season-patterns-v1",
        "multiple-testing-redteam-v1",
    ])
    parser.add_argument("--iterations", type=int, required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--shard-index", type=int, default=0)
    parser.add_argument("--shard-count", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=50000)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    local_iterations = shard_iterations(args.iterations, args.shard_index, args.shard_count)
    local_seed = args.seed + args.shard_index * 1_000_003
    rng = np.random.default_rng(local_seed)
    started = time.perf_counter()

    if args.preset == "portfolio-null-geometry-v1":
        result = simulate_portfolio_geometry(rng, local_iterations, args.batch_size)
    elif args.preset == "selection-shadow-v1":
        result = simulate_selection_shadow(rng, local_iterations, args.batch_size)
    elif args.preset == "null-season-patterns-v1":
        result = simulate_null_seasons(rng, local_iterations, min(250, args.batch_size), 267)
    else:
        result = simulate_multiple_testing(rng, local_iterations, min(250, args.batch_size), 267)

    payload = {
        "engine_version": ENGINE_VERSION,
        "preset": args.preset,
        "total_requested_iterations": args.iterations,
        "iterations": local_iterations,
        "seed": local_seed,
        "shard_index": args.shard_index,
        "shard_count": args.shard_count,
        "runtime_seconds": time.perf_counter() - started,
        **result,
    }
    payload["result_sha256"] = canonical_hash(payload)
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({"output": str(path), "iterations": local_iterations, "sha256": payload["result_sha256"]}))


if __name__ == "__main__":
    main()
