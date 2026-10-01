from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CATEGORY_BY_PRESET = {
    "portfolio-null-geometry-v1": "PORTFOLIO_GEOMETRY",
    "selection-shadow-v1": "SELECTION_SHADOW",
    "null-season-patterns-v1": "NULL_HISTORY",
    "multiple-testing-redteam-v1": "MULTIPLE_TESTING",
}


def request(method: str, url: str, key: str, payload=None, prefer="return=representation"):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        raise RuntimeError(f"Supabase REST {method} {url}: {exc.code} {body}") from exc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", required=True)
    parser.add_argument("--shards-dir", required=True)
    parser.add_argument("--github-run-id", required=True)
    parser.add_argument("--github-sha", required=True)
    parser.add_argument("--seed-base", type=int, required=True)
    args = parser.parse_args()

    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    result = json.loads(Path(args.result).read_text(encoding="utf-8"))
    preset = result["preset"]
    category = CATEGORY_BY_PRESET[preset]
    now = datetime.now(timezone.utc).isoformat()
    slug = f"gh-{args.github_run_id}-{preset}"

    experiment_payload = {
        "slug": slug,
        "name": f"GitHub {args.github_run_id} · {preset}",
        "preset_slug": preset,
        "category": category,
        "hypothesis": "Simulation experiment; interpretation follows the preset preregistration.",
        "engine_version": result["engine_version"],
        "git_commit_sha": args.github_sha,
        "config": {
            "github_run_id": args.github_run_id,
            "result_sha256": result["result_sha256"],
            "source": "github_actions",
        },
        "requested_iterations": result["iterations"],
        "seed_base": args.seed_base,
        "shard_count": result["shards"],
        "status": "DRAFT",
    }
    created = request("POST", f"{base}/simulation_experiments?select=id", key, experiment_payload)
    experiment_id = created[0]["id"]

    request("PATCH", f"{base}/simulation_experiments?id=eq.{urllib.parse.quote(experiment_id)}", key,
            {"status": "FROZEN", "frozen_at": now})
    request("PATCH", f"{base}/simulation_experiments?id=eq.{urllib.parse.quote(experiment_id)}", key,
            {"status": "RUNNING"})

    shard_files = sorted(Path(args.shards_dir).rglob("*.json"))
    chunk_rows = []
    for file in shard_files:
        shard = json.loads(file.read_text(encoding="utf-8"))
        chunk_rows.append({
            "simulation_experiment_id": experiment_id,
            "chunk_index": shard["shard_index"],
            "iterations": shard["iterations"],
            "seed_start": shard["seed"],
            "status": "COMPLETED",
            "runtime_ms": round(float(shard["runtime_seconds"]) * 1000),
            "summary": {"counters": shard.get("counters", {})},
            "result_sha256": shard["result_sha256"],
            "started_at": now,
            "completed_at": now,
        })
    if chunk_rows:
        request("POST", f"{base}/simulation_chunks", key, chunk_rows, "return=minimal")

    metric_rows = []
    for family, values in result.get("probabilities", {}).items():
        for metric, value in values.items():
            metric_rows.append({
                "simulation_experiment_id": experiment_id,
                "metric_name": f"{family}.{metric}",
                "metric_value": value,
                "details": {"iterations": result["iterations"]},
            })
    if metric_rows:
        request("POST", f"{base}/simulation_metrics", key, metric_rows, "return=minimal")

    histogram_rows = []
    for metric, values in result.get("histograms", {}).items():
        keys = sorted(values, key=lambda x: float(x))
        histogram_rows.append({
            "simulation_experiment_id": experiment_id,
            "metric_name": metric,
            "bin_edges": [float(k) for k in keys],
            "counts": [int(values[k]) for k in keys],
            "total_count": sum(int(values[k]) for k in keys),
        })
    if histogram_rows:
        request("POST", f"{base}/simulation_histograms", key, histogram_rows, "return=minimal")

    request("PATCH", f"{base}/simulation_experiments?id=eq.{urllib.parse.quote(experiment_id)}", key,
            {"status": "COMPLETED", "completed_at": now})
    print(json.dumps({"simulation_experiment_id": experiment_id, "slug": slug, "result_sha256": result["result_sha256"]}))


if __name__ == "__main__":
    main()
