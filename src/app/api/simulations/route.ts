import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { isLabAdmin } from "@/lib/lab-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function gitSha() {
  const value = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.SIMULATION_GIT_SHA;
  if (!value || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value)) {
    throw new Error("No hay un Git SHA válido disponible para congelar la corrida.");
  }
  return value;
}

function normalizeIterations(value: unknown) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 1_000_000_000) {
    throw new Error("Las iteraciones deben estar entre 1 y 1.000.000.000.");
  }
  return n;
}

export async function POST(request: Request) {
  if (!(await isLabAdmin())) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }
  try {
    const body = await request.json();
    const preset = typeof body?.preset === "string" ? body.preset : "";
    const name = typeof body?.name === "string" ? body.name.slice(0, 120) : "";
    const iterations = normalizeIterations(body?.iterations);
    const seed = Number.isSafeInteger(Number(body?.seed)) ? Number(body.seed) : Date.now() * 1000 + randomInt(0, 999);
    const priority = Math.max(0, Math.min(100, Number(body?.priority ?? 50)));
    const config = body?.config && typeof body.config === "object" && !Array.isArray(body.config) ? body.config : {};
    if (!preset) throw new Error("Elegí un preset.");

    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("create_simulation_job", {
      p_name: name,
      p_preset_slug: preset,
      p_requested_iterations: iterations,
      p_seed_base: seed,
      p_config: config,
      p_git_commit_sha: gitSha(),
      p_priority: priority,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, job: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo crear la simulación." }, { status: 400 });
  }
}
