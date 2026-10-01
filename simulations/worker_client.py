from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


class SupabaseWorkerClient:
    def __init__(self, url: str | None = None, key: str | None = None) -> None:
        self.supabase_url = (url or os.environ.get("SUPABASE_URL") or "").rstrip("/")
        self.worker_token = os.environ.get("SIM_WORKER_TOKEN")
        self.gateway_url = os.environ.get("SIMULATION_GATEWAY_URL") or (
            f"{self.supabase_url}/functions/v1/simulation-gateway" if self.supabase_url else ""
        )
        self.key = key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        self.root = f"{self.supabase_url}/rest/v1" if self.supabase_url else ""
        if not self.worker_token and not self.key:
            raise RuntimeError("SIM_WORKER_TOKEN or SUPABASE_SERVICE_ROLE_KEY is required")

    @property
    def gateway_mode(self) -> bool:
        return bool(self.worker_token and self.gateway_url)

    def _gateway(self, action: str, payload: dict | None = None) -> Any:
        if not self.gateway_mode:
            raise RuntimeError("simulation gateway is not configured")
        data = json.dumps({"action": action, "payload": payload or {}}).encode()
        req = urllib.request.Request(self.gateway_url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("x-poceada-token", self.worker_token or "")
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                body = json.loads(response.read().decode() or "{}")
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode()
            raise RuntimeError(f"Simulation gateway {action}: {exc.code} {raw}") from exc
        if not body.get("ok"):
            raise RuntimeError(f"Simulation gateway {action}: {body.get('error', 'unknown failure')}")
        return body.get("data")

    def _request(self, method: str, path: str, payload: Any = None, prefer: str = "return=representation") -> Any:
        if not self.key:
            raise RuntimeError("legacy Supabase REST fallback requires SUPABASE_SERVICE_ROLE_KEY")
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
        if self.gateway_mode:
            self._gateway("upsert_worker", {"row": payload})
            return
        self._request("POST", "/simulation_workers?on_conflict=id", payload, "resolution=merge-duplicates,return=minimal")

    def mark_stale(self) -> int:
        if self.gateway_mode:
            result = self._gateway("mark_stale", {})
        else:
            result = self._request("POST", "/rpc/mark_stale_simulation_jobs", {})
        if isinstance(result, int):
            return result
        if isinstance(result, list) and result:
            first = result[0]
            if isinstance(first, int):
                return first
        return int(result or 0)

    def claim(self, worker_id: str, lease_seconds: int = 120) -> dict | None:
        if self.gateway_mode:
            result = self._gateway("claim_next", {"worker_id": worker_id, "lease_seconds": lease_seconds})
        else:
            result = self._request("POST", "/rpc/claim_simulation_job", {"p_worker_id": worker_id, "p_lease_seconds": lease_seconds})
        return self._one(result)

    def claim_by_id(self, job_id: str, worker_id: str, lease_seconds: int = 300) -> dict | None:
        if self.gateway_mode:
            result = self._gateway("claim_by_id", {"job_id": job_id, "worker_id": worker_id, "lease_seconds": lease_seconds})
        else:
            result = self._request("POST", "/rpc/claim_simulation_job_by_id", {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_lease_seconds": lease_seconds,
            })
        return self._one(result)

    def heartbeat(self, job_id: str, worker_id: str, progress_iterations: int, phase: str, lease_seconds: int = 120, partial_summary: dict | None = None) -> dict:
        if self.gateway_mode:
            result = self._gateway("heartbeat", {
                "job_id": job_id,
                "worker_id": worker_id,
                "progress_iterations": progress_iterations,
                "phase": phase,
                "lease_seconds": lease_seconds,
                "partial_summary": partial_summary or {},
            })
        else:
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
        if self.gateway_mode:
            result = self._gateway("complete", {
                "job_id": job_id,
                "worker_id": worker_id,
                "result_sha256": result_sha256,
                "result_summary": summary,
                "runtime_ms": runtime_ms,
            })
        else:
            result = self._request("POST", "/rpc/complete_simulation_job", {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_result_sha256": result_sha256,
                "p_result_summary": summary,
                "p_runtime_ms": runtime_ms,
            })
        return self._one(result) or {}

    def fail(self, job_id: str, worker_id: str, code: str, message: str, runtime_ms: int) -> dict:
        if self.gateway_mode:
            result = self._gateway("fail", {
                "job_id": job_id,
                "worker_id": worker_id,
                "error_code": code,
                "error_message": message,
                "runtime_ms": runtime_ms,
            })
        else:
            result = self._request("POST", "/rpc/fail_simulation_job", {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_error_code": code,
                "p_error_message": message,
                "p_runtime_ms": runtime_ms,
            })
        return self._one(result) or {}

    def acknowledge_cancel(self, job_id: str, worker_id: str, runtime_ms: int) -> dict:
        if self.gateway_mode:
            result = self._gateway("ack_cancel", {"job_id": job_id, "worker_id": worker_id, "runtime_ms": runtime_ms})
        else:
            result = self._request("POST", "/rpc/acknowledge_cancelled_simulation_job", {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_runtime_ms": runtime_ms,
            })
        return self._one(result) or {}

    def upsert_chunk(self, row: dict) -> None:
        if self.gateway_mode:
            self._gateway("upsert_chunk", {"row": row})
            return
        self._request("POST", "/simulation_chunks?on_conflict=simulation_experiment_id,chunk_index", row, "resolution=merge-duplicates,return=minimal")

    def upsert_metrics(self, rows: list[dict]) -> None:
        if not rows:
            return
        if self.gateway_mode:
            self._gateway("upsert_metrics", {"rows": rows})
            return
        self._request("POST", "/simulation_metrics?on_conflict=simulation_experiment_id,metric_name", rows, "resolution=merge-duplicates,return=minimal")

    def upsert_histograms(self, rows: list[dict]) -> None:
        if not rows:
            return
        if self.gateway_mode:
            self._gateway("upsert_histograms", {"rows": rows})
            return
        self._request("POST", "/simulation_histograms?on_conflict=simulation_experiment_id,metric_name", rows, "resolution=merge-duplicates,return=minimal")
