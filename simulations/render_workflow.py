from __future__ import annotations

import json
import os
import platform
import socket
from typing import Any

import numpy as np
from render import TaskContext, Workflows

from simulations.run_simulation import ENGINE_VERSION
from simulations.worker import WORKER_VERSION, now_iso, process_job as process_simulation_job
from simulations.worker_client import SupabaseWorkerClient

WORKFLOW_VERSION = "RENDER_WORKFLOW_V1"

app = Workflows(default_timeout=86_400, default_plan="flex")


def worker_payload(worker_id: str, job_id: str | None = None) -> dict[str, Any]:
    return {
        "id": worker_id,
        "display_name": "POCEADA Render Workflow",
        "worker_version": f"{WORKER_VERSION}+{WORKFLOW_VERSION}",
        "engine_version": ENGINE_VERSION,
        "status": "BUSY" if job_id else "ONLINE",
        "capabilities": {
            "mode": "on_demand_workflow",
            "python": platform.python_version(),
            "numpy": np.__version__,
            "platform": platform.platform(),
            "presets": [
                "portfolio-null-geometry-v1",
                "selection-shadow-v1",
                "null-season-patterns-v1",
                "multiple-testing-redteam-v1",
                "portfolio-optimizer-v1",
            ],
        },
        "cpu_count": os.cpu_count() or 1,
        "current_job_id": job_id,
        "last_seen_at": now_iso(),
    }


@app.task(name="process_job", timeout_seconds=86_400, plan="flex")
def process_job_task(ctx: TaskContext, job_id: str) -> dict[str, Any]:
    """Claim one exact Supabase job, process it, persist results, then exit.

    The database claim makes duplicate task dispatches safe: only the first task
    can transition the target job from QUEUED to CLAIMED.
    """
    client = SupabaseWorkerClient()
    worker_id = f"render-workflow-{socket.gethostname()}-{os.getpid()}"
    client.upsert_worker(worker_payload(worker_id))

    job = client.claim_by_id(job_id, worker_id, lease_seconds=900)
    if not job:
        result = {"job_id": job_id, "status": "NOT_CLAIMED", "reason": "job is not queued or was already claimed"}
        print(json.dumps(result), flush=True)
        return result

    client.upsert_worker(worker_payload(worker_id, job_id))
    print(json.dumps({"message": "workflow job claimed", "job_id": job_id, "worker_id": worker_id}), flush=True)

    try:
        process_simulation_job(client, worker_id, job)
        result = {"job_id": job_id, "status": "PROCESSED", "worker_id": worker_id}
    except Exception as exc:
        # process_simulation_job already records FAILED in Supabase. Returning a
        # normal workflow result prevents Render's own retry layer from creating
        # duplicate attempts; retries remain explicit and auditable in our queue.
        result = {
            "job_id": job_id,
            "status": "FAILED_RECORDED_IN_SUPABASE",
            "worker_id": worker_id,
            "error": str(exc)[:1000],
        }
    print(json.dumps(result), flush=True)
    return result


if __name__ == "__main__":
    app.start()
