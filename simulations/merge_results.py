from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path


def canonical_hash(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def merge() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    files = sorted(Path(args.input_dir).rglob("*.json"))
    if not files:
        raise SystemExit("no shard JSON files found")

    shards = [json.loads(path.read_text(encoding="utf-8")) for path in files]
    presets = {s["preset"] for s in shards}
    engines = {s["engine_version"] for s in shards}
    if len(presets) != 1 or len(engines) != 1:
        raise SystemExit("cannot merge different presets or engines")

    counters: dict[str, Counter] = defaultdict(Counter)
    histograms: dict[str, Counter] = defaultdict(Counter)
    total_iterations = 0
    total_runtime = 0.0

    for shard in shards:
        total_iterations += int(shard["iterations"])
        total_runtime += float(shard["runtime_seconds"])
        for family, values in shard.get("counters", {}).items():
            for key, value in values.items():
                counters[family][key] += int(value)
        for metric, values in shard.get("histograms", {}).items():
            for key, value in values.items():
                histograms[metric][key] += int(value)

    probabilities = {
        family: {key: value / total_iterations for key, value in values.items()}
        for family, values in counters.items()
    }

    payload = {
        "engine_version": next(iter(engines)),
        "preset": next(iter(presets)),
        "iterations": total_iterations,
        "shards": len(shards),
        "aggregate_runtime_seconds": total_runtime,
        "counters": {k: dict(v) for k, v in counters.items()},
        "probabilities": probabilities,
        "histograms": {k: dict(v) for k, v in histograms.items()},
        "shard_hashes": [s["result_sha256"] for s in sorted(shards, key=lambda x: x["shard_index"])],
    }
    payload["result_sha256"] = canonical_hash(payload)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({"output": str(out), "iterations": total_iterations, "sha256": payload["result_sha256"]}))


if __name__ == "__main__":
    merge()
