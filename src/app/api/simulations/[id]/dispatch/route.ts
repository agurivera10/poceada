import { NextResponse } from "next/server";
import { isLabAdmin } from "@/lib/lab-auth";
import { dispatchSimulationJob } from "@/lib/render-workflow";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isLabAdmin())) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }
  try {
    const { id } = await context.params;
    const supabase = createAdminClient();
    const { data: job, error } = await supabase
      .from("simulation_jobs")
      .select("id,status,dispatch_ref,execution_backend")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!job) throw new Error("Job inexistente.");
    if (job.status !== "QUEUED") throw new Error(`Sólo se puede despachar un job QUEUED; estado actual: ${job.status}.`);

    const dispatch = await dispatchSimulationJob(id);
    return NextResponse.json({ ok: dispatch.ok, job, dispatch }, { status: dispatch.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo despachar." }, { status: 400 });
  }
}
