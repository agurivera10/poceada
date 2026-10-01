from __future__ import annotations

import hashlib
import json
import os
import platform
import socket
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone

import numpy as np

from simulations.optimizer import optimize_portfolio
from simulations.run_simulation import (
    ENGINE_VERSION,
    simulate_multiple_testing,
    simulate_null_seasons,
    simulate_portfolio_geometry,
    simulate_selection_shadow,
)
from simulations.worker_client import SupabaseWorkerClient

WORKER_VERSION = "PY_WORKER_V1"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_hash(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def merge_nested(target: dict[str, Counter], source: dict) -> None:
    for family, values in source.items():
        for key, value in values.items():
            target[family][key] += int(value)


def merge_histograms(target: dict[str, Counter], source: dict) -> None:
    for metric, values in source.items():
        for key, value in values.items():
            target[metric][key] += int(value)


def run_simulation_chunk(preset: str, iterations: int, seed: int, config: dict) -> dict:
    rng = np.random.default_rng(seed)
    if preset == "portfolio-null-geometry-v1":
        return simulate_portfolio_geometry(rng, iterations, min(50_000, max(1, iterations)))
    if preset == "selection-shadow-v1":
        return simulate_selection_shadow(rng, iterations, min(50_000, max(1, iterations)))
    if preset == "null-season-patterns-v1":
        return simulate_null_seasons(rng, iterations, min(250, max(1, iterations)), int(config.get("draws_per_season", 267)))
    if preset == "multiple-testing-redteam-v1":
        return simulate_multiple_testing(rng, iterations, min(250, max(1, iterations)), int(config.get("train_draws", 267)))
    raise ValueError(f"unsupported simulation preset: {preset}")


def persist_aggregates(
    client: SupabaseWorkerClient,
    experiment_id: str,
    total_iterations: int,
    event_counts: dict[str, Counter],
    ticket_sums: dict[str, Counter],
    histograms: dict[str, Counter],
    job_id: str,
) -> tuple[dict, dict]:
    event_probabilities = {
        family: {key: value / total_iterations for key, value in values.items()}
        for family, values in event_counts.items()
    }
    ticket_expectations = {
        family: {key: value / total_iterations for key, value in values.items()}
        for family, values in ticket_sums.items()
    }
    metrics: list[dict] = []
    for family, values in event_probabilities.items():
        for metric, value in values.items():
            metrics.append({
                "simulation_experiment_id": experiment_id,
                "metric_name": f"event.{family}.{metric}",
                "metric_value": value,
                "details": {"iterations": total_iterations, "job_id": job_id, "semantics": "probability"},
            })
    for family, values in ticket_expectations.items():
        for metric, value in values.items():
            metrics.append({
                "simulation_experiment_id": experiment_id,
                "metric_name": f"expectation.{family}.{metric}",
                "metric_value": value,
                "details": {"iterations": total_iterations, "job_id": job_id, "semantics": "expected_tickets_per_draw"},
            })
    client.upsert_metrics(metrics)

    hist_rows = []
    for metric, values in histograms.items():
        keys = sorted(values, key=lambda x: float(x))
        hist_rows.append({
            "simulation_experiment_id": experiment_id,
            "metric_name": metric,
            "bin_edges": [float(k) for k in keys],
            "counts": [int(values[k]) for k in keys],
            "total_count": sum(int(values[k]) for k in keys),
        })
    client.upsert_histograms(hist_rows)
    return event_probabilities, ticket_expectations


def run_optimizer_job(client: SupabaseWorkerClient, worker_id: str, job: dict) -> None:
    job_id = job["id"]
    experiment_id = job["simulation_experiment_id"]
    iterations = int(job["requested_iterations"])
    seed = int(job["seed_base"])
    config = job.get("config") or {}
    started = time.perf_counter()

    def progress(done: int, best: dict) -> None:
        response = client.heartbeat(
            job_id,
            worker_id,
            min(done, iterations),
            "optimize",
            partial_summary={"best_score": best},
        )
        if response.get("cancel_requested"):
            raise InterruptedError("cancel requested")

    try:
        result = optimize_portfolio(
            pool_numbers=config.get("pool_numbers"),
            ticket_count=int(config.get("ticket_count", 6)),
            ticket_size=int(config.get("ticket_size", 5)),
            iterations=iterations,
            seed=seed,
            on_progress=progress,
        )
        exact = result.get("exact") or {}
        metric_rows: list[dict] = []
        for metric, value in (exact.get("event_probabilities") or {}).items():
            metric_rows.append({
                "simulation_experiment_id": experiment_id,
                "metric_name": f"event.optimizer_best.{metric}",
                "metric_value": value,
                "details": {"semantics": "exact_probability", "job_id": job_id},
            })
        for metric, value in (exact.get("ticket_expectations") or {}).items():
            metric_rows.append({
                "simulation_experiment_id": experiment_id,
                "metric_name": f"expectation.optimizer_best.{metric}",
                "metric_value": value,
                "details": {"semantics": "exact_expected_tickets_per_draw", "job_id": job_id},
            })
        for metric in ("unique_4_subsets", "max_pair_overlap", "usage_range", "usage_variance"):
            metric_rows.append({
                "simulation_experiment_id": experiment_id,
                "metric_name": f"optimizer.{metric}",
                "metric_value": float(result["score"][metric]),
                "details": {"job_id": job_id},
            })
        client.upsert_metrics(metric_rows)
        runtime_ms = round((time.perf_counter() - started) * 1000)
        client.upsert_chunk({
            "simulation_experiment_id": experiment_id,
            "chunk_index": 0,
            "iterations": iterations,
            "seed_start": seed,
            "status": "COMPLETED",
            "runtime_ms": runtime_ms,
            "summary": {"score": result["score"], "tickets": result["tickets"]},
            "result_sha256": result["result_sha256"],
            "started_at": now_iso(),
            "completed_at": now_iso(),
        })
        client.complete(job_id, worker_id, result["result_sha256"], {
            "optimizer": {"tickets": result["tickets"], "score": result["score"], "exact": exact},
            "engine_version": ENGINE_VERSION,
        }, runtime_ms)
    except InterruptedError:
        client.acknowledge_cancel(job_id, worker_id, round((time.perf_counter() - started) * 1000))


def run_monte_carlo_job(client: SupabaseWorkerClient, worker_id: str, job: dict) -> None:
    job_id = job["id"]
    experiment_id = job["simulation_experiment_id"]
    preset = job["preset_slug"]
    total = int(job["requested_iterations"])
    seed_base = int(job["seed_base"])
    config = job.get("config") or {}
    if preset in ("null-season-patterns-v1", "multiple-testing-redteam-v1"):
        default_chunk = 5_000
    else:
        default_chunk = 1_000_000
    chunk_size = max(1, int(config.get("compute_chunk_iterations", os.getenv("WORKER_CHUNK_ITERATIONS", default_chunk))))
    event_counts: dict[str, Counter] = defaultdict(Counter)
    ticket_sums: dict[str, Counter] = defaultdict(Counter)
    histograms: dict[str, Counter] = defaultdict(Counter)
    started = time.perf_counter()
    progress = 0
    chunk_index = 0

    while progress < total:
        n = min(chunk_size, total - progress)
        chunk_seed = seed_base + chunk_index * 1_000_003
        chunk_started = time.perf_counter()
        chunk_result = run_simulation_chunk(preset, n, chunk_seed, config)
        merge_nested(event_counts, chunk_result.get("event_counts", {}))
        merge_nested(ticket_sums, chunk_result.get("ticket_sums", {}))
        merge_histograms(histograms, chunk_result.get("histograms", {}))
        progress += n
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
        client.upsert_chunk({
            "simulation_experiment_id": experiment_id,
            "chunk_index": chunk_index,
            "iterations": n,
            "seed_start": chunk_seed,
            "status": "COMPLETED",
            "runtime_ms": round((time.perf_counter() - chunk_started) * 1000),
            "summary": {"event_counts": chunk_result.get("event_counts", {}), "ticket_sums": chunk_result.get("ticket_sums", {})},
            "result_sha256": chunk_sha,
            "started_at": now_iso(),
            "completed_at": now_iso(),
        })
        heartbeat = client.heartbeat(
            job_id,
            worker_id,
            progress,
            "simulate",
            partial_summary={"chunks_completed": chunk_index + 1, "last_chunk_sha256": chunk_sha},
        )
        if heartbeat.get("cancel_requested"):
            client.acknowledge_cancel(job_id, worker_id, round((time.perf_counter() - started) * 1000))
            return
        chunk_index += 1

    event_probabilities, ticket_expectations = persist_aggregates(
        client, experiment_id, total, event_counts, ticket_sums, histograms, job_id
    )
    result_payload = {
        "engine_version": ENGINE_VERSION,
        "preset": preset,
        "iterations": total,
        "seed_base": seed_base,
        "config": config,
        "event_probabilities": event_probabilities,
        "ticket_expectations": ticket_expectations,
        "histograms": {k: dict(v) for k, v in histograms.items()},
    }
    result_sha = canonical_hash(result_payload)
    runtime_ms = round((time.perf_counter() - started) * 1000)
    client.complete(job_id, worker_id, result_sha, {
        "engine_version": ENGINE_VERSION,
        "event_probabilities": event_probabilities,
        "ticket_expectations": ticket_expectations,
        "chunks_completed": chunk_index,
    }, runtime_ms)


def process_job(client: SupabaseWorkerClient, worker_id: str, job: dict) -> None:
    started = time.perf_counter()
    try:
        if job.get("preset_slug") == "portfolio-optimizer-v1":
            run_optimizer_job(client, worker_id, job)
        else:
            run_monte_carlo_job(client, worker_id, job)
    except Exception as exc:
        try:
            client.fail(
                job["id"],
                worker_id,
                type(exc).__name__.upper(),
                str(exc),
                round((time.perf_counter() - started) * 1000),
            )
        except Exception as nested:
            print(json.dumps({"level": "error", "message": "failed to report worker error", "error": str(nested)}), flush=True)
        raise


def main() -> None:
    worker_id = os.getenv("WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}"
    display_name = os.getenv("WORKER_NAME") or socket.gethostname()
    poll_seconds = max(1.0, float(os.getenv("WORKER_POLL_SECONDS", "2")))
    client = SupabaseWorkerClient()
    base_worker = {
        "id": worker_id,
        "display_name": display_name,
        "worker_version": WORKER_VERSION,
        "engine_version": ENGINE_VERSION,
        "status": "ONLINE",
        "capabilities": {
            "presets": [
                "portfolio-null-geometry-v1",
                "selection-shadow-v1",
                "null-season-patterns-v1",
                "multiple-testing-redteam-v1",
                "portfolio-optimizer-v1",
            ],
            "python": platform.python_version(),
            "numpy": np.__version__,
            "platform": platform.platform(),
        },
        "cpu_count": os.cpu_count() or 1,
        "current_job_id": None,
        "last_seen_at": now_iso(),
    }
    print(json.dumps({"message": "POCEADA LAB worker online", "worker_id": worker_id, "engine": ENGINE_VERSION}), flush=True)

    while True:
        try:
            idle = dict(base_worker)
            idle["last_seen_at"] = now_iso()
            client.upsert_worker(idle)
            job = client.claim(worker_id, 180)
            if not job:
                time.sleep(poll_seconds)
                continue
            print(json.dumps({"message": "job claimed", "job_id": job["id"], "preset": job.get("preset_slug"), "iterations": job["requested_iterations"]}), flush=True)
            process_job(client, worker_id, job)
        except KeyboardInterrupt:
            print(json.dumps({"message": "worker stopped"}), flush=True)
            return
        except Exception as exc:
            print(json.dumps({"level": "error", "message": "worker loop error", "error": str(exc)}), flush=True)
            time.sleep(min(30.0, poll_seconds * 3))


if __name__ == "__main__":
    main()
