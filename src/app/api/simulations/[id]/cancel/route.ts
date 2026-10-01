import { NextResponse } from "next/server";
import { isLabAdmin } from "@/lib/lab-auth";
import { cancelRenderTaskRun } from "@/lib/render-workflow";
import { simulationGateway } from "@/lib/simulation-gateway";
import { createPublicClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isLabAdmin())) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }
  try {
    const { id } = await context.params;
    const supabase = createPublicClient();
    const { data: current, error: readError } = await supabase
      .from("simulation_jobs")
      .select("id,status,execution_backend,dispatch_ref")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) throw new Error("Job inexistente.");

    const data = await simulationGateway("cancel_job", { job_id: id });
    let remoteCancel: unknown = null;
    if (current.execution_backend === "RENDER_WORKFLOW" && current.dispatch_ref) {
      remoteCancel = await cancelRenderTaskRun(current.dispatch_ref);
    }
    return NextResponse.json({ ok: true, job: data, remoteCancel });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo cancelar." }, { status: 400 });
  }
}
