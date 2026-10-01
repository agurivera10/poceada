from __future__ import annotations

import time
from collections import Counter, defaultdict
from typing import Literal

from simulations.run_simulation import ENGINE_VERSION
from simulations.worker import (
    canonical_hash,
    merge_histograms,
    merge_nested,
    now_iso,
    persist_aggregates,
    run_optimizer_job,
    run_simulation_chunk,
)
from simulations.worker_client import SupabaseWorkerClient

Outcome = Literal["COMPLETED", "YIELDED", "CANCELLED"]


def _nested_counters(value: dict | None) -> dict[str, Counter]:
    target: dict[str, Counter] = defaultdict(Counter)
    for family, values in (value or {}).items():
        target[str(family)].update({str(key): int(count) for key, count in (values or {}).items()})
    return target


def _checkpoint_core(
    completed_iterations: int,
    next_chunk_index: int,
    event_counts: dict[str, Counter],
    ticket_sums: dict[str, Counter],
    histograms: dict[str, Counter],
    accumulated_runtime_ms: int,
) -> dict:
    return {
        "completed_iterations": int(completed_iterations),
        "next_chunk_index": int(next_chunk_index),
        "event_counts": {family: dict(values) for family, values in event_counts.items()},
        "ticket_sums": {family: dict(values) for family, values in ticket_sums.items()},
        "histograms": {metric: dict(values) for metric, values in histograms.items()},
        "accumulated_runtime_ms": int(accumulated_runtime_ms),
    }


def _make_checkpoint(
    completed_iterations: int,
    next_chunk_index: int,
    event_counts: dict[str, Counter],
    ticket_sums: dict[str, Counter],
    histograms: dict[str, Counter],
    accumulated_runtime_ms: int,
) -> dict:
    core = _checkpoint_core(
        completed_iterations,
        next_chunk_index,
        event_counts,
        ticket_sums,
        histograms,
        accumulated_runtime_ms,
    )
    return {**core, "checkpoint_sha256": canonical_hash(core)}


def _restore_checkpoint(job: dict, total: int) -> tuple[int, int, dict[str, Counter], dict[str, Counter], dict[str, Counter], int]:
    summary = job.get("result_summary") or {}
    checkpoint = summary.get("checkpoint") if isinstance(summary, dict) else None
    if not checkpoint:
        return 0, 0, defaultdict(Counter), defaultdict(Counter), defaultdict(Counter), 0
    if not isinstance(checkpoint, dict):
        raise ValueError("checkpoint must be an object")

    expected = str(checkpoint.get("checkpoint_sha256") or "")
    core = {key: value for key, value in checkpoint.items() if key != "checkpoint_sha256"}
    if len(expected) != 64 or canonical_hash(core) != expected:
        raise ValueError("checkpoint SHA-256 mismatch")

    completed = int(checkpoint.get("completed_iterations", 0))
    next_chunk = int(checkpoint.get("next_chunk_index", 0))
    if completed < 0 or completed > total or next_chunk < 0:
        raise ValueError("checkpoint progress is outside job bounds")

    event_counts = _nested_counters(checkpoint.get("event_counts"))
    ticket_sums = _nested_counters(checkpoint.get("ticket_sums"))
    histograms = _nested_counters(checkpoint.get("histograms"))
    accumulated_runtime_ms = int(checkpoint.get("accumulated_runtime_ms", 0) or 0)
    return completed, next_chunk, event_counts, ticket_sums, histograms, accumulated_runtime_ms


def _segment_budget(preset: str, config: dict, chunk_size: int, remaining: int) -> int:
    if preset in ("null-season-patterns-v1", "multiple-testing-redteam-v1"):
        default_budget = 100_000
    else:
        default_budget = 5_000_000
    requested = max(chunk_size, int(config.get("compute_segment_iterations", default_budget)))
    aligned = max(chunk_size, (requested // chunk_size) * chunk_size)
    return min(remaining, aligned)


def run_monte_carlo_job(client: SupabaseWorkerClient, worker_id: str, job: dict) -> Outcome:
    job_id = str(job["id"])
    experiment_id = str(job["simulation_experiment_id"])
    preset = str(job["preset_slug"])
    total = int(job["requested_iterations"])
    seed_base = int(job["seed_base"])
    config = job.get("config") or {}

    if preset in ("null-season-patterns-v1", "multiple-testing-redteam-v1"):
        default_chunk = 5_000
    else:
        default_chunk = 1_000_000
    chunk_size = max(1, int(config.get("compute_chunk_iterations", default_chunk)))

    progress, chunk_index, event_counts, ticket_sums, histograms, accumulated_runtime_ms = _restore_checkpoint(job, total)
    segment_started = time.perf_counter()
    segment_budget = _segment_budget(preset, config, chunk_size, total - progress)
    segment_target = min(total, progress + segment_budget)

    # Reconcile the public progress indicator with the durable checkpoint before doing new work.
    initial_checkpoint = _make_checkpoint(
        progress,
        chunk_index,
        event_counts,
        ticket_sums,
        histograms,
        accumulated_runtime_ms,
    )
    initial_heartbeat = client.heartbeat(
        job_id,
        worker_id,
        progress,
        "resume" if progress else "simulate",
        lease_seconds=900,
        partial_summary={
            "checkpoint": initial_checkpoint,
            "checkpoint_resumed": bool(progress),
            "chunks_completed": chunk_index,
        },
    )
    if initial_heartbeat.get("cancel_requested"):
        client.acknowledge_cancel(job_id, worker_id, accumulated_runtime_ms)
        return "CANCELLED"

    while progress < segment_target:
        n = min(chunk_size, segment_target - progress, total - progress)
        chunk_seed = seed_base + chunk_index * 1_000_003
        chunk_started = time.perf_counter()
        chunk_result = run_simulation_chunk(preset, n, chunk_seed, config)

        merge_nested(event_counts, chunk_result.get("event_counts", {}))
        merge_nested(ticket_sums, chunk_result.get("ticket_sums", {}))
        merge_histograms(histograms, chunk_result.get("histograms", {}))

        progress += n
        next_chunk_index = chunk_index + 1
        chunk_payload = {
            "preset": preset,
            "chunk_index": chunk_index,
            "iterations": n,
            "seed": chunk_seed,
            "event_counts": chunk_result.get("event_counts", {}),
            "ticket_sums": chunk_result.get("ticket_sums", {}),
            "histograms": chunk_result.get("histograms", {}),
        }
        chunk_sha = canonical_hash(chunk_payload)
        chunk_runtime_ms = round((time.perf_counter() - chunk_started) * 1000)
        accumulated_runtime_ms += chunk_runtime_ms

        client.upsert_chunk({
            "simulation_experiment_id": experiment_id,
            "chunk_index": chunk_index,
            "iterations": n,
            "seed_start": chunk_seed,
            "status": "COMPLETED",
            "runtime_ms": chunk_runtime_ms,
            "summary": {
                "event_counts": chunk_result.get("event_counts", {}),
                "ticket_sums": chunk_result.get("ticket_sums", {}),
                "histograms": chunk_result.get("histograms", {}),
            },
            "result_sha256": chunk_sha,
            "started_at": now_iso(),
            "completed_at": now_iso(),
        })

        checkpoint = _make_checkpoint(
            progress,
            next_chunk_index,
            event_counts,
            ticket_sums,
            histograms,
            accumulated_runtime_ms,
        )
        heartbeat = client.heartbeat(
            job_id,
            worker_id,
            progress,
            "simulate",
            lease_seconds=900,
            partial_summary={
                "checkpoint": checkpoint,
                "chunks_completed": next_chunk_index,
                "last_chunk_sha256": chunk_sha,
                "segment_target": segment_target,
            },
        )
        if heartbeat.get("cancel_requested"):
            client.acknowledge_cancel(job_id, worker_id, accumulated_runtime_ms)
            return "CANCELLED"
        chunk_index = next_chunk_index

    if progress < total:
        checkpoint = _make_checkpoint(
            progress,
            chunk_index,
            event_counts,
            ticket_sums,
            histograms,
            accumulated_runtime_ms,
        )
        client.heartbeat(
            job_id,
            worker_id,
            progress,
            "checkpoint_yield",
            lease_seconds=30,
            partial_summary={
                "checkpoint": checkpoint,
                "chunks_completed": chunk_index,
                "segment_runtime_ms": round((time.perf_counter() - segment_started) * 1000),
                "continuation_required": True,
            },
        )
        return "YIELDED"

    event_probabilities, ticket_expectations = persist_aggregates(
        client,
        experiment_id,
        total,
        event_counts,
        ticket_sums,
        histograms,
        job_id,
    )
    result_payload = {
        "engine_version": ENGINE_VERSION,
        "preset": preset,
        "iterations": total,
        "seed_base": seed_base,
        "config": config,
        "event_probabilities": event_probabilities,
        "ticket_expectations": ticket_expectations,
        "histograms": {key: dict(value) for key, value in histograms.items()},
    }
    result_sha = canonical_hash(result_payload)
    client.complete(job_id, worker_id, result_sha, {
        "engine_version": ENGINE_VERSION,
        "event_probabilities": event_probabilities,
        "ticket_expectations": ticket_expectations,
        "chunks_completed": chunk_index,
        "checkpoint": _make_checkpoint(
            total,
            chunk_index,
            event_counts,
            ticket_sums,
            histograms,
            accumulated_runtime_ms,
        ),
    }, accumulated_runtime_ms)
    return "COMPLETED"


def process_job(client: SupabaseWorkerClient, worker_id: str, job: dict) -> Outcome:
    started = time.perf_counter()
    try:
        if job.get("preset_slug") == "portfolio-optimizer-v1":
            run_optimizer_job(client, worker_id, job)
            return "COMPLETED"
        return run_monte_carlo_job(client, worker_id, job)
    except Exception as exc:
        try:
            client.fail(
                str(job["id"]),
                worker_id,
                type(exc).__name__.upper(),
                str(exc),
                round((time.perf_counter() - started) * 1000),
            )
        except Exception as nested:
            print({"level": "error", "message": "failed to report worker error", "error": str(nested)}, flush=True)
        raise
