import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
function reply(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }
async function sha256(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function adminClient() {
  const root = Deno.env.get("SUPABASE_URL")!;
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const secret = keys.default;
  if (!root || !secret) throw new Error("Supabase secret runtime is unavailable");
  return createClient(root, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function authenticate(req: Request, supabase: ReturnType<typeof adminClient>) {
  const token = req.headers.get("x-poceada-token") || "";
  if (token.length < 32) return null;
  const digest = await sha256(token);
  const { data, error } = await supabase.from("simulation_api_tokens").select("token_id,role,active").eq("token_sha256", digest).eq("active", true).maybeSingle();
  return error || !data ? null : data as { token_id: string; role: "APP" | "WORKER"; active: boolean };
}
async function rpc(supabase: ReturnType<typeof adminClient>, fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST required" });
  try {
    const supabase = adminClient();
    const auth = await authenticate(req, supabase);
    if (!auth) return reply(401, { ok: false, error: "invalid gateway token" });
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    const appActions = new Set(["create_job", "cancel_job", "retry_job", "mark_dispatched"]);
    const workerActions = new Set(["claim_by_id","claim_next","heartbeat","complete","fail","ack_cancel","upsert_worker","upsert_chunk","upsert_metrics","upsert_histograms","mark_stale"]);
    if (appActions.has(action) && auth.role !== "APP") return reply(403, { ok: false, error: "APP token required" });
    if (workerActions.has(action) && auth.role !== "WORKER") return reply(403, { ok: false, error: "WORKER token required" });
    if (!appActions.has(action) && !workerActions.has(action)) return reply(400, { ok: false, error: "unsupported action" });

    let data: unknown;
    switch (action) {
      case "create_job": data = await rpc(supabase, "create_simulation_job", payload); break;
      case "cancel_job": data = await rpc(supabase, "request_cancel_simulation_job", { p_job_id: payload.job_id }); break;
      case "retry_job": data = await rpc(supabase, "retry_simulation_job", { p_job_id: payload.job_id }); break;
      case "mark_dispatched": data = await rpc(supabase, "mark_simulation_job_dispatched", { p_job_id: payload.job_id, p_backend: payload.backend, p_dispatch_ref: payload.dispatch_ref, p_metadata: payload.metadata || {} }); break;
      case "claim_by_id": data = await rpc(supabase, "claim_simulation_job_by_id", { p_job_id: payload.job_id, p_worker_id: payload.worker_id, p_lease_seconds: payload.lease_seconds || 300 }); break;
      case "claim_next": data = await rpc(supabase, "claim_simulation_job", { p_worker_id: payload.worker_id, p_lease_seconds: payload.lease_seconds || 180 }); break;
      case "heartbeat": data = await rpc(supabase, "heartbeat_simulation_job", { p_job_id: payload.job_id, p_worker_id: payload.worker_id, p_progress_iterations: payload.progress_iterations, p_phase: payload.phase, p_lease_seconds: payload.lease_seconds || 180, p_partial_summary: payload.partial_summary || {} }); break;
      case "complete": data = await rpc(supabase, "complete_simulation_job", { p_job_id: payload.job_id, p_worker_id: payload.worker_id, p_result_sha256: payload.result_sha256, p_result_summary: payload.result_summary || {}, p_runtime_ms: payload.runtime_ms ?? null }); break;
      case "fail": data = await rpc(supabase, "fail_simulation_job", { p_job_id: payload.job_id, p_worker_id: payload.worker_id, p_error_code: payload.error_code, p_error_message: payload.error_message, p_runtime_ms: payload.runtime_ms ?? null }); break;
      case "ack_cancel": data = await rpc(supabase, "acknowledge_cancelled_simulation_job", { p_job_id: payload.job_id, p_worker_id: payload.worker_id, p_runtime_ms: payload.runtime_ms ?? null }); break;
      case "mark_stale": data = await rpc(supabase, "mark_stale_simulation_jobs", {}); break;
      case "upsert_worker": { const { data: row, error } = await supabase.from("simulation_workers").upsert(payload.row, { onConflict: "id" }).select().maybeSingle(); if (error) throw new Error(error.message); data = row; break; }
      case "upsert_chunk": { const { error } = await supabase.from("simulation_chunks").upsert(payload.row, { onConflict: "simulation_experiment_id,chunk_index" }); if (error) throw new Error(error.message); data = { saved: true }; break; }
      case "upsert_metrics": { const rows = Array.isArray(payload.rows) ? payload.rows : []; if (rows.length) { const { error } = await supabase.from("simulation_metrics").upsert(rows, { onConflict: "simulation_experiment_id,metric_name" }); if (error) throw new Error(error.message); } data = { saved: rows.length }; break; }
      case "upsert_histograms": { const rows = Array.isArray(payload.rows) ? payload.rows : []; if (rows.length) { const { error } = await supabase.from("simulation_histograms").upsert(rows, { onConflict: "simulation_experiment_id,metric_name" }); if (error) throw new Error(error.message); } data = { saved: rows.length }; break; }
    }
    return reply(200, { ok: true, role: auth.role, data });
  } catch (error) {
    return reply(400, { ok: false, error: error instanceof Error ? error.message : "gateway failure" });
  }
});
