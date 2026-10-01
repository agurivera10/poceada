import { NextResponse } from "next/server";
import { isLabAdmin } from "@/lib/lab-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isLabAdmin())) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }
  try {
    const { id } = await context.params;
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("request_cancel_simulation_job", { p_job_id: id });
    if (error) throw error;
    return NextResponse.json({ ok: true, job: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo cancelar." }, { status: 400 });
  }
}
