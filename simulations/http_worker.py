from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from simulations.resumable_worker import process_job
from simulations.worker_client import SupabaseWorkerClient

HOST = "0.0.0.0"
PORT = int(os.getenv("PORT", "10000"))
DISPATCH_TOKEN = os.environ.get("COMPUTE_DISPATCH_TOKEN", "")
SERVICE_ID = os.environ.get("WORKER_ID", "poceada-render-free")
AUTO_RUN_JOB_ID = os.environ.get("AUTO_RUN_JOB_ID", "").strip()
LAB_CONTINUE_URL = os.environ.get("LAB_CONTINUE_URL", "").strip()

_lock = threading.Lock()
_state: dict[str, Any] = {"job_id": None, "started_at": None, "last_error": None, "last_outcome": None}


def constant_time_equal(a: str, b: str) -> bool:
    if not a or not b:
        return False
    return hashlib.sha256(a.encode()).digest() == hashlib.sha256(b.encode()).digest()


def request_continuation(job_id: str) -> None:
    if not LAB_CONTINUE_URL or not DISPATCH_TOKEN:
        print(json.dumps({"level": "warning", "message": "checkpoint continuation not configured", "job_id": job_id}), flush=True)
        return
    data = json.dumps({"job_id": job_id}).encode()
    req = urllib.request.Request(LAB_CONTINUE_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("x-compute-token", DISPATCH_TOKEN)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            raw = response.read().decode()
            body = json.loads(raw or "{}")
            print(json.dumps({
                "message": "checkpoint continuation requested",
                "job_id": job_id,
                "http_status": response.status,
                "ok": bool(body.get("ok")),
                "dispatch": body.get("dispatch"),
            }), flush=True)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
        print(json.dumps({
            "level": "error",
            "message": "checkpoint continuation request failed",
            "job_id": job_id,
            "error": str(exc)[:1000],
        }), flush=True)


def execute(job_id: str) -> None:
    client = SupabaseWorkerClient()
    started = time.time()
    outcome: str | None = None
    try:
        job = client.claim_by_id(job_id, SERVICE_ID, 900)
        if not job:
            _state["last_error"] = "job was not claimable"
            return
        outcome = process_job(client, SERVICE_ID, job)
        _state["last_outcome"] = outcome
    except Exception as exc:
        _state["last_error"] = f"{type(exc).__name__}: {exc}"[:1000]
    finally:
        _state["job_id"] = None
        _state["started_at"] = None
        _lock.release()
        print(json.dumps({
            "message": "free compute segment finished",
            "job_id": job_id,
            "runtime_seconds": round(time.time() - started, 3),
            "outcome": outcome,
            "error": _state.get("last_error"),
        }), flush=True)

    if outcome == "YIELDED":
        request_continuation(job_id)


def launch(job_id: str) -> bool:
    if not job_id or not _lock.acquire(blocking=False):
        return False
    _state.update({"job_id": job_id, "started_at": time.time(), "last_error": None, "last_outcome": None})
    thread = threading.Thread(target=execute, args=(job_id,), daemon=True, name=f"poceada-{job_id[:8]}")
    thread.start()
    return True


class Handler(BaseHTTPRequestHandler):
    server_version = "POCEADACompute/2.0"

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
                "continuation_configured": bool(LAB_CONTINUE_URL),
                "busy": _lock.locked(),
                "job_id": _state.get("job_id"),
                "last_outcome": _state.get("last_outcome"),
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
        dispatch_ref = f"render-free:{job_id}:{int(time.time())}"
        self.send_json(202, {"ok": True, "accepted": True, "job_id": job_id, "dispatch_ref": dispatch_ref})


if __name__ == "__main__":
    configured = bool(DISPATCH_TOKEN and os.environ.get("SIM_WORKER_TOKEN"))
    print(json.dumps({
        "message": "POCEADA free compute online",
        "port": PORT,
        "worker_id": SERVICE_ID,
        "configured": configured,
        "continuation_configured": bool(LAB_CONTINUE_URL),
    }), flush=True)
    if AUTO_RUN_JOB_ID and configured:
        accepted = launch(AUTO_RUN_JOB_ID)
        print(json.dumps({"message": "acceptance bootstrap", "job_id": AUTO_RUN_JOB_ID, "accepted": accepted}), flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
