import "server-only";

import { simulationGateway } from "@/lib/simulation-gateway";

export type RenderDispatchResult = {
  configured: boolean;
  ok: boolean;
  backend?: "RENDER_WORKFLOW" | "PYTHON_WORKER";
  taskRunId?: string;
  status?: string;
  error?: string;
};

function config() {
  return {
    apiKey: process.env.RENDER_API_KEY,
    task: process.env.RENDER_WORKFLOW_TASK,
    freeUrl: process.env.RENDER_FREE_COMPUTE_URL,
    freeToken: process.env.RENDER_FREE_COMPUTE_TOKEN,
  };
}

async function auditDispatch(jobId: string, backend: "RENDER_WORKFLOW" | "PYTHON_WORKER", dispatchRef: string, metadata: Record<string, unknown>) {
  await simulationGateway("mark_dispatched", {
    job_id: jobId,
    backend,
    dispatch_ref: dispatchRef,
    metadata,
  });
}

async function dispatchFreeCompute(jobId: string): Promise<RenderDispatchResult> {
  const { freeUrl, freeToken } = config();
  if (!freeUrl || !freeToken) {
    return { configured: false, ok: false, error: "No Render compute backend is configured." };
  }
  try {
    const response = await fetch(`${freeUrl.replace(/\/$/, "")}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-compute-token": freeToken },
      body: JSON.stringify({ job_id: jobId }),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return { configured: true, ok: false, backend: "PYTHON_WORKER", error: typeof body.error === "string" ? body.error : `Free compute HTTP ${response.status}` };
    }
    const dispatchRef = typeof body.dispatch_ref === "string" ? body.dispatch_ref : `render-free:${jobId}`;
    await auditDispatch(jobId, "PYTHON_WORKER", dispatchRef, { provider: "render_free_web", url: freeUrl });
    return { configured: true, ok: true, backend: "PYTHON_WORKER", status: "accepted" };
  } catch (error) {
    return { configured: true, ok: false, backend: "PYTHON_WORKER", error: error instanceof Error ? error.message : "Free compute dispatch failed." };
  }
}

export async function dispatchSimulationJob(jobId: string): Promise<RenderDispatchResult> {
  const { apiKey, task } = config();
  if (!apiKey || !task) return dispatchFreeCompute(jobId);

  try {
    const idempotencyKey = `poceada-simulation-${jobId}`;
    const response = await fetch("https://api.render.com/v1/task-runs", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ task, input: [jobId], idempotencyKey }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const workflowError = typeof body.message === "string" ? body.message : `Render API returned HTTP ${response.status}`;
      const fallback = await dispatchFreeCompute(jobId);
      return fallback.ok ? fallback : { configured: true, ok: false, backend: "RENDER_WORKFLOW", error: `${workflowError}; fallback: ${fallback.error ?? "unavailable"}` };
    }

    const taskRunId = typeof body.id === "string" ? body.id : undefined;
    const status = typeof body.status === "string" ? body.status : undefined;
    if (!taskRunId) return { configured: true, ok: false, backend: "RENDER_WORKFLOW", error: "Render accepted the request but did not return a task run id." };

    try {
      await auditDispatch(jobId, "RENDER_WORKFLOW", taskRunId, { provider: "render_workflows", task, initial_status: status ?? null, idempotency_key: idempotencyKey });
    } catch (error) {
      return { configured: true, ok: false, backend: "RENDER_WORKFLOW", taskRunId, status, error: `Render task started, but dispatch audit failed: ${error instanceof Error ? error.message : "unknown gateway error"}` };
    }
    return { configured: true, ok: true, backend: "RENDER_WORKFLOW", taskRunId, status };
  } catch (error) {
    const fallback = await dispatchFreeCompute(jobId);
    return fallback.ok ? fallback : { configured: true, ok: false, backend: "RENDER_WORKFLOW", error: `${error instanceof Error ? error.message : "Render Workflow dispatch failed."}; fallback: ${fallback.error ?? "unavailable"}` };
  }
}

export async function cancelRenderTaskRun(taskRunId: string): Promise<{ configured: boolean; ok: boolean; error?: string }> {
  const { apiKey } = config();
  if (!apiKey) return { configured: false, ok: false, error: "Render API key is not configured." };
  try {
    const response = await fetch(`https://api.render.com/v1/task-runs/${encodeURIComponent(taskRunId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 204 || response.status === 404) return { configured: true, ok: true };
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { configured: true, ok: false, error: typeof body.message === "string" ? body.message : `Render API returned HTTP ${response.status}` };
  } catch (error) {
    return { configured: true, ok: false, error: error instanceof Error ? error.message : "Render cancel failed." };
  }
}
