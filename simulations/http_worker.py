from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from simulations.worker import process_job
from simulations.worker_client import SupabaseWorkerClient

HOST = "0.0.0.0"
PORT = int(os.getenv("PORT", "10000"))
DISPATCH_TOKEN = os.environ.get("COMPUTE_DISPATCH_TOKEN", "")
SERVICE_ID = os.environ.get("WORKER_ID", "poceada-render-free")
AUTO_RUN_JOB_ID = os.environ.get("AUTO_RUN_JOB_ID", "").strip()

_lock = threading.Lock()
_state: dict[str, Any] = {"job_id": None, "started_at": None, "last_error": None}


def constant_time_equal(a: str, b: str) -> bool:
    if not a or not b:
        return False
    return hashlib.sha256(a.encode()).digest() == hashlib.sha256(b.encode()).digest()


def execute(job_id: str) -> None:
    client = SupabaseWorkerClient()
    started = time.time()
    try:
        job = client.claim_by_id(job_id, SERVICE_ID, 900)
        if not job:
            _state["last_error"] = "job was not claimable"
            return
        process_job(client, SERVICE_ID, job)
    except Exception as exc:
        _state["last_error"] = f"{type(exc).__name__}: {exc}"[:1000]
    finally:
        _state["job_id"] = None
        _state["started_at"] = None
        _lock.release()
        print(json.dumps({"message": "free compute finished", "job_id": job_id, "runtime_seconds": round(time.time() - started, 3), "error": _state.get("last_error")}), flush=True)


def launch(job_id: str) -> bool:
    if not job_id or not _lock.acquire(blocking=False):
        return False
    _state.update({"job_id": job_id, "started_at": time.time(), "last_error": None})
    thread = threading.Thread(target=execute, args=(job_id,), daemon=True, name=f"poceada-{job_id[:8]}")
    thread.start()
    return True


class Handler(BaseHTTPRequestHandler):
    server_version = "POCEADACompute/1.0"

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt: str, *args: object) -> None:
        print(json.dumps({"http": fmt % args}), flush=True)

    def do_HEAD(self) -> None:
        if self.path in ("/", "/health"):
            self.send_response(200)
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def do_GET(self) -> None:
        if self.path in ("/", "/health"):
            self.send_json(200, {
                "ok": True,
                "configured": bool(DISPATCH_TOKEN and os.environ.get("SIM_WORKER_TOKEN")),
                "busy": _lock.locked(),
                "job_id": _state.get("job_id"),
                "last_error": _state.get("last_error"),
            })
            return
        self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/run":
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        if not DISPATCH_TOKEN or not os.environ.get("SIM_WORKER_TOKEN"):
            self.send_json(503, {"ok": False, "error": "compute is locked until secrets are configured"})
            return
        if not constant_time_equal(self.headers.get("x-compute-token", ""), DISPATCH_TOKEN):
            self.send_json(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode() or "{}")
            job_id = str(body.get("job_id", ""))
        except Exception:
            self.send_json(400, {"ok": False, "error": "invalid json"})
            return
        if not job_id:
            self.send_json(400, {"ok": False, "error": "job_id required"})
            return
        if not launch(job_id):
            self.send_json(409, {"ok": False, "error": "compute busy", "job_id": _state.get("job_id")})
            return
        dispatch_ref = f"render-free:{job_id}"
        self.send_json(202, {"ok": True, "accepted": True, "job_id": job_id, "dispatch_ref": dispatch_ref})


if __name__ == "__main__":
    configured = bool(DISPATCH_TOKEN and os.environ.get("SIM_WORKER_TOKEN"))
    print(json.dumps({"message": "POCEADA free compute online", "port": PORT, "worker_id": SERVICE_ID, "configured": configured}), flush=True)
    if AUTO_RUN_JOB_ID and configured:
        accepted = launch(AUTO_RUN_JOB_ID)
        print(json.dumps({"message": "acceptance bootstrap", "job_id": AUTO_RUN_JOB_ID, "accepted": accepted}), flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
