import "server-only";

import { createAdminClient } from "@/lib/supabase-admin";

export type RenderDispatchResult = {
  configured: boolean;
  ok: boolean;
  taskRunId?: string;
  status?: string;
  error?: string;
};

function renderConfig() {
  return {
    apiKey: process.env.RENDER_API_KEY,
    task: process.env.RENDER_WORKFLOW_TASK,
  };
}

export async function dispatchSimulationJob(jobId: string): Promise<RenderDispatchResult> {
  const { apiKey, task } = renderConfig();
  if (!apiKey || !task) {
    return {
      configured: false,
      ok: false,
      error: "Render Workflow dispatcher is not configured on this web service.",
    };
  }

  try {
    const response = await fetch("https://api.render.com/v1/task-runs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task,
        input: [jobId],
        idempotencyKey: `poceada-simulation-${jobId}`,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const detail = typeof body.message === "string" ? body.message : `Render API returned HTTP ${response.status}`;
      return { configured: true, ok: false, error: detail };
    }

    const taskRunId = typeof body.id === "string" ? body.id : undefined;
    const status = typeof body.status === "string" ? body.status : undefined;
    if (!taskRunId) {
      return { configured: true, ok: false, error: "Render accepted the request but did not return a task run id." };
    }

    const supabase = createAdminClient();
    const { error } = await supabase.rpc("mark_simulation_job_dispatched", {
      p_job_id: jobId,
      p_backend: "RENDER_WORKFLOW",
      p_dispatch_ref: taskRunId,
      p_metadata: {
        provider: "render_workflows",
        task,
        initial_status: status ?? null,
        idempotency_key: `poceada-simulation-${jobId}`,
      },
    });
    if (error) {
      return {
        configured: true,
        ok: false,
        taskRunId,
        status,
        error: `Render task started, but dispatch audit failed: ${error.message}`,
      };
    }

    return { configured: true, ok: true, taskRunId, status };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      error: error instanceof Error ? error.message : "Render Workflow dispatch failed.",
    };
  }
}

export async function cancelRenderTaskRun(taskRunId: string): Promise<{ configured: boolean; ok: boolean; error?: string }> {
  const { apiKey } = renderConfig();
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
    return {
      configured: true,
      ok: false,
      error: typeof body.message === "string" ? body.message : `Render API returned HTTP ${response.status}`,
    };
  } catch (error) {
    return { configured: true, ok: false, error: error instanceof Error ? error.message : "Render cancel failed." };
  }
}
