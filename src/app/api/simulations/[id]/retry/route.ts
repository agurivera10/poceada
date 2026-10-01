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
    const { data, error } = await supabase.rpc("retry_simulation_job", { p_job_id: id });
    if (error) throw error;
    const job = Array.isArray(data) ? data[0] : data;
    if (!job?.id) throw new Error("El retry no devolvió un job válido.");
    const dispatch = await dispatchSimulationJob(job.id);
    return NextResponse.json({ ok: true, job, dispatch });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo reintentar." }, { status: 400 });
  }
}
