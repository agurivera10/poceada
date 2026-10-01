from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from itertools import combinations
from typing import Callable, Iterable

import numpy as np


def canonical_hash(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def _score_portfolio(tickets: tuple[tuple[int, ...], ...], pool_size: int) -> tuple[int, int, int, float]:
    four_sets: set[tuple[int, ...]] = set()
    max_overlap = 0
    usage = Counter()
    for ticket in tickets:
        usage.update(ticket)
        four_sets.update(tuple(sorted(c)) for c in combinations(ticket, 4))
    for a, b in combinations(tickets, 2):
        max_overlap = max(max_overlap, len(set(a) & set(b)))
    counts = np.array([usage[i] for i in range(pool_size)], dtype=np.float64)
    usage_range = int(counts.max() - counts.min()) if len(counts) else 0
    variance = float(counts.var()) if len(counts) else 0.0
    return (len(four_sets), -max_overlap, -usage_range, -variance)


def _ticket_masks(tickets: Iterable[Iterable[int]]) -> list[int]:
    masks: list[int] = []
    for ticket in tickets:
        mask = 0
        for n in ticket:
            mask |= 1 << int(n)
        masks.append(mask)
    return masks


def exact_portfolio_metrics(tickets: tuple[tuple[int, ...], ...], pool_size: int) -> dict:
    if pool_size > 22:
        raise ValueError("exact enumeration is capped at pool_size <= 22")
    outside = 100 - pool_size
    denominator = math.comb(100, 10)
    masks = _ticket_masks(tickets)
    event = {tier: 0.0 for tier in range(2, 6)}
    expected_exact = {tier: 0.0 for tier in range(2, 6)}
    expected_plus = {tier: 0.0 for tier in range(2, 6)}
    max_distribution = {tier: 0.0 for tier in range(0, 6)}

    for subset_mask in range(1 << pool_size):
        inside_hits = subset_mask.bit_count()
        outside_needed = 10 - inside_hits
        if outside_needed < 0 or outside_needed > outside:
            continue
        weight = math.comb(outside, outside_needed) / denominator
        ticket_hits = [(subset_mask & mask).bit_count() for mask in masks]
        max_hits = max(ticket_hits, default=0)
        max_distribution[max_hits] += weight
        for tier in range(2, 6):
            if max_hits >= tier:
                event[tier] += weight
            expected_exact[tier] += weight * sum(h == tier for h in ticket_hits)
            expected_plus[tier] += weight * sum(h >= tier for h in ticket_hits)

    return {
        "event_probabilities": {f"at_least_{tier}": event[tier] for tier in range(2, 6)},
        "ticket_expectations": {
            **{f"exactly_{tier}": expected_exact[tier] for tier in range(2, 6)},
            **{f"at_least_{tier}": expected_plus[tier] for tier in range(2, 6)},
        },
        "max_hit_distribution": {str(k): v for k, v in max_distribution.items() if v > 0},
    }


def optimize_portfolio(
    pool_numbers: list[int] | None = None,
    ticket_count: int = 6,
    ticket_size: int = 5,
    iterations: int = 250_000,
    seed: int = 317900001,
    on_progress: Callable[[int, dict], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> dict:
    pool_numbers = pool_numbers or list(range(15))
    if len(pool_numbers) != len(set(pool_numbers)):
        raise ValueError("pool_numbers must be unique")
    if any(n < 0 or n > 99 for n in pool_numbers):
        raise ValueError("pool_numbers must be between 0 and 99")
    pool_size = len(pool_numbers)
    if ticket_size < 4 or ticket_size > pool_size:
        raise ValueError("ticket_size must be between 4 and pool_size")
    if ticket_count < 1 or ticket_count > 30:
        raise ValueError("ticket_count must be between 1 and 30")
    if iterations < 1:
        raise ValueError("iterations must be positive")

    all_tickets = [tuple(c) for c in combinations(range(pool_size), ticket_size)]
    rng = np.random.default_rng(seed)

    if pool_size == 15 and ticket_count == 6 and ticket_size == 5:
        current: tuple[tuple[int, ...], ...] = (
            (0, 1, 2, 3, 4),
            (0, 5, 6, 7, 8),
            (1, 8, 9, 10, 11),
            (2, 7, 9, 12, 13),
            (4, 6, 11, 12, 14),
            (3, 5, 10, 13, 14),
        )
    else:
        idx = rng.choice(len(all_tickets), size=ticket_count, replace=False)
        current = tuple(all_tickets[int(i)] for i in idx)

    current_score = _score_portfolio(current, pool_size)
    best = current
    best_score = current_score
    report_every = max(1_000, min(25_000, iterations // 100 if iterations >= 100 else 1))

    for i in range(1, iterations + 1):
        pos = int(rng.integers(0, ticket_count))
        candidate_ticket = all_tickets[int(rng.integers(0, len(all_tickets)))]
        if candidate_ticket in current:
            continue
        proposal = list(current)
        proposal[pos] = candidate_ticket
        proposal_tuple = tuple(sorted(proposal))
        proposal_score = _score_portfolio(proposal_tuple, pool_size)
        if proposal_score >= current_score:
            current, current_score = proposal_tuple, proposal_score
        elif rng.random() < 0.0005:
            current, current_score = proposal_tuple, proposal_score
        if current_score > best_score:
            best, best_score = current, current_score
        if i % report_every == 0:
            if should_cancel and should_cancel():
                raise InterruptedError("optimizer cancelled")
            if on_progress:
                on_progress(i, {
                    "unique_4_subsets": best_score[0],
                    "max_pair_overlap": -best_score[1],
                    "usage_range": -best_score[2],
                    "usage_variance": -best_score[3],
                })

    usage = Counter(n for ticket in best for n in ticket)
    mapped_tickets = [[pool_numbers[i] for i in ticket] for ticket in best]
    exact = exact_portfolio_metrics(best, pool_size) if pool_size <= 22 else None
    result = {
        "pool_numbers": pool_numbers,
        "ticket_count": ticket_count,
        "ticket_size": ticket_size,
        "search_iterations": iterations,
        "seed": seed,
        "tickets": mapped_tickets,
        "score": {
            "unique_4_subsets": best_score[0],
            "max_pair_overlap": -best_score[1],
            "usage_range": -best_score[2],
            "usage_variance": -best_score[3],
            "usage": {str(pool_numbers[i]): usage[i] for i in range(pool_size)},
        },
        "exact": exact,
    }
    result["result_sha256"] = canonical_hash(result)
    return result
