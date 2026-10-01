import { NextResponse } from "next/server";
import { isLabAdmin } from "@/lib/lab-auth";
import { dispatchSimulationJob } from "@/lib/render-workflow";
import { simulationGateway } from "@/lib/simulation-gateway";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isLabAdmin())) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }
  try {
    const { id } = await context.params;
    const data = await simulationGateway<unknown>("retry_job", { job_id: id });
    const job = Array.isArray(data) ? data[0] : data;
    if (!job || typeof job !== "object" || !("id" in job)) {
      throw new Error("El retry no devolvió un job válido.");
    }
    const dispatch = await dispatchSimulationJob(String((job as { id: string }).id));
    return NextResponse.json({ ok: true, job, dispatch });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo reintentar." }, { status: 400 });
  }
}
