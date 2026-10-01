from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


class SupabaseWorkerClient:
    def __init__(self, url: str | None = None, key: str | None = None) -> None:
        self.root = (url or os.environ["SUPABASE_URL"]).rstrip("/") + "/rest/v1"
        self.key = key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    def _request(self, method: str, path: str, payload: Any = None, prefer: str = "return=representation") -> Any:
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(self.root + path, data=data, method=method)
        req.add_header("apikey", self.key)
        req.add_header("Authorization", f"Bearer {self.key}")
        req.add_header("Content-Type", "application/json")
        if prefer:
            req.add_header("Prefer", prefer)
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                raw = response.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            body = exc.read().decode()
            raise RuntimeError(f"Supabase REST {method} {path}: {exc.code} {body}") from exc

    @staticmethod
    def _one(value: Any) -> dict | None:
        if value is None:
            return None
        if isinstance(value, list):
            return value[0] if value else None
        return value

    def upsert_worker(self, payload: dict) -> None:
        self._request("POST", "/simulation_workers?on_conflict=id", payload, "resolution=merge-duplicates,return=minimal")

    def mark_stale(self) -> int:
        result = self._request("POST", "/rpc/mark_stale_simulation_jobs", {})
        if isinstance(result, int):
            return result
        if isinstance(result, list) and result:
            first = result[0]
            if isinstance(first, int):
                return first
        return int(result or 0)

    def claim(self, worker_id: str, lease_seconds: int = 120) -> dict | None:
        result = self._request("POST", "/rpc/claim_simulation_job", {"p_worker_id": worker_id, "p_lease_seconds": lease_seconds})
        return self._one(result)

    def claim_by_id(self, job_id: str, worker_id: str, lease_seconds: int = 300) -> dict | None:
        result = self._request("POST", "/rpc/claim_simulation_job_by_id", {
            "p_job_id": job_id,
            "p_worker_id": worker_id,
            "p_lease_seconds": lease_seconds,
        })
        return self._one(result)

    def heartbeat(self, job_id: str, worker_id: str, progress_iterations: int, phase: str, lease_seconds: int = 120, partial_summary: dict | None = None) -> dict:
        result = self._request("POST", "/rpc/heartbeat_simulation_job", {
            "p_job_id": job_id,
            "p_worker_id": worker_id,
            "p_progress_iterations": progress_iterations,
            "p_phase": phase,
            "p_lease_seconds": lease_seconds,
            "p_partial_summary": partial_summary or {},
        })
        return self._one(result) or {}

    def complete(self, job_id: str, worker_id: str, result_sha256: str, summary: dict, runtime_ms: int) -> dict:
        result = self._request("POST", "/rpc/complete_simulation_job", {
            "p_job_id": job_id,
            "p_worker_id": worker_id,
            "p_result_sha256": result_sha256,
            "p_result_summary": summary,
            "p_runtime_ms": runtime_ms,
        })
        return self._one(result) or {}

    def fail(self, job_id: str, worker_id: str, code: str, message: str, runtime_ms: int) -> dict:
        result = self._request("POST", "/rpc/fail_simulation_job", {
            "p_job_id": job_id,
            "p_worker_id": worker_id,
            "p_error_code": code,
            "p_error_message": message,
            "p_runtime_ms": runtime_ms,
        })
        return self._one(result) or {}

    def acknowledge_cancel(self, job_id: str, worker_id: str, runtime_ms: int) -> dict:
        result = self._request("POST", "/rpc/acknowledge_cancelled_simulation_job", {
            "p_job_id": job_id,
            "p_worker_id": worker_id,
            "p_runtime_ms": runtime_ms,
        })
        return self._one(result) or {}

    def upsert_chunk(self, row: dict) -> None:
        self._request("POST", "/simulation_chunks?on_conflict=simulation_experiment_id,chunk_index", row, "resolution=merge-duplicates,return=minimal")

    def upsert_metrics(self, rows: list[dict]) -> None:
        if rows:
            self._request("POST", "/simulation_metrics?on_conflict=simulation_experiment_id,metric_name", rows, "resolution=merge-duplicates,return=minimal")

    def upsert_histograms(self, rows: list[dict]) -> None:
        if rows:
            self._request("POST", "/simulation_histograms?on_conflict=simulation_experiment_id,metric_name", rows, "resolution=merge-duplicates,return=minimal")
