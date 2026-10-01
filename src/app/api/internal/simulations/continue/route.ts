import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchSimulationJob } from "@/lib/render-workflow";

export const runtime = "nodejs";

function constantTimeEqual(a: string, b: string) {
  if (!a || !b) return false;
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const expected = process.env.RENDER_FREE_COMPUTE_TOKEN ?? "";
  const provided = request.headers.get("x-compute-token") ?? "";
  if (!constantTimeEqual(provided, expected)) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const jobId = typeof body?.job_id === "string" ? body.job_id : "";
    if (!jobId) throw new Error("job_id requerido.");

    const dispatch = await dispatchSimulationJob(jobId);
    return NextResponse.json(
      { ok: dispatch.ok, job_id: jobId, dispatch },
      { status: dispatch.ok ? 200 : 502 },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "No se pudo continuar la simulación." },
      { status: 400 },
    );
  }
}
