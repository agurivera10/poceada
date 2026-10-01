import Link from "next/link";
import { SimulationControl } from "@/components/simulation-control";
import { isLabAdmin } from "@/lib/lab-auth";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function compact(value: number | string | null | undefined) {
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

function categoryLabel(value: string) {
  const labels: Record<string, string> = {
    PORTFOLIO_GEOMETRY: "Geometría",
    NULL_HISTORY: "Historia nula",
    SELECTION_SHADOW: "Shadows",
    MULTIPLE_TESTING: "Red team",
    BANKROLL: "Riesgo económico",
    RANDOMNESS: "Aleatoriedad",
    OPTIMIZATION: "Optimización",
    CUSTOM: "Custom",
  };
  return labels[value] ?? value;
}

export default async function SimulacionesPage() {
  const supabase = createPublicClient();
  const [statusRes, computeRes, presetsRes, experimentsRes, shadowRes, jobsRes, workersRes, authorized] = await Promise.all([
    supabase.from("simulation_lab_status").select("*").maybeSingle(),
    supabase.from("simulation_compute_status").select("*").maybeSingle(),
    supabase.from("simulation_presets").select("slug,name,category,description,engine_version,default_iterations,max_recommended_iterations,default_config").eq("active", true).order("name"),
    supabase.from("simulation_experiments").select("id,slug,name,category,status,requested_iterations,shard_count,experiment_sha256,created_at,completed_at").order("created_at", { ascending: false }).limit(16),
    supabase.from("shadow_batches").select("id,target_draw_number,shadow_count,generator_version,geometry_template,batch_sha256,frozen_at").order("target_draw_number", { ascending: false }).limit(3),
    supabase.from("simulation_jobs").select("id,simulation_experiment_id,preset_slug,status,priority,requested_iterations,progress_iterations,seed_base,current_phase,worker_id,attempt,cancel_requested,result_sha256,error_message,created_at,started_at,completed_at").order("created_at", { ascending: false }).limit(40),
    supabase.from("simulation_workers").select("id,display_name,worker_version,engine_version,status,cpu_count,current_job_id,last_seen_at,completed_jobs,failed_jobs").order("last_seen_at", { ascending: false }).limit(12),
    isLabAdmin(),
  ]);

  const errors = [statusRes.error, computeRes.error, presetsRes.error, experimentsRes.error, shadowRes.error, jobsRes.error, workersRes.error].filter(Boolean);
  if (errors.length) throw new Error(errors.map((e) => e?.message).join(" | "));

  const status = statusRes.data ?? { active_presets: 0, experiments: 0, completed_experiments: 0, completed_iterations: 0, completed_chunks: 0, materialized_shadows: 0, shadow_evaluations: 0 };
  const compute = computeRes.data ?? { queued_jobs: 0, active_jobs: 0, completed_jobs: 0, failed_jobs: 0, processed_iterations: 0, online_workers: 0, busy_workers: 0 };
  const presets = presetsRes.data ?? [];
  const experiments = experimentsRes.data ?? [];
  const shadows = shadowRes.data ?? [];
  const jobs = jobsRes.data ?? [];
  const workers = workersRes.data ?? [];

  return (
    <main>
      <div className="shell">
        <section className="hero">
          <div>
            <div className="eyebrow">SIMULATION LAB V2 · PYTHON COMPUTE</div>
            <h1>Un laboratorio de cómputo, no un botón de Monte Carlo.</h1>
            <p>Cola persistente en Supabase, workers Python desacoplados, progreso en vivo, cancelación, seeds reproducibles, SHA-256, métricas 2/3/4/5 y optimización combinatoria. GitHub queda para código y CI; el cómputo corre donde decidamos.</p>
          </div>
          <div className="hero-note">
            <strong>Compute plane desacoplado</strong>
            <span>La app puede encolar 100K, 100M o 1B iteraciones. Un worker disponible toma el job. Si no hay worker, la corrida queda segura en cola; si un worker cae, el lease permite detectarlo.</span>
            <div className="meta-row" style={{ marginTop: 14 }}><span>Engine <strong>V2</strong></span><span>Queue <strong>Supabase</strong></span><span>Runtime <strong>Python 3.13</strong></span></div>
          </div>
        </section>

        <section className="grid-kpi">
          <div className="card kpi"><div className="kpi-label">Workers online</div><div className="kpi-value">{compute.online_workers}</div><div className="kpi-sub">{compute.busy_workers} ocupados</div></div>
          <div className="card kpi"><div className="kpi-label">En cola</div><div className="kpi-value">{compute.queued_jobs}</div><div className="kpi-sub">jobs esperando compute</div></div>
          <div className="card kpi"><div className="kpi-label">Activos</div><div className="kpi-value">{compute.active_jobs}</div><div className="kpi-sub">claimed/running/cancelling</div></div>
          <div className="card kpi"><div className="kpi-label">Iteraciones</div><div className="kpi-value">{compact(Number(status.completed_iterations) + Number(compute.processed_iterations))}</div><div className="kpi-sub">históricas + activas</div></div>
          <div className="card kpi"><div className="kpi-label">Shadows</div><div className="kpi-value">{compact(status.materialized_shadows)}</div><div className="kpi-sub">controles prospectivos</div></div>
        </section>

        <SimulationControl presets={presets} initialJobs={jobs} initialWorkers={workers} initialAuthorized={authorized} />

        <section className="section">
          <div className="section-head"><div><div className="eyebrow">EXPERIMENT DESIGNER</div><h2>Familias disponibles</h2></div><div className="section-desc">Los presets fijan el significado del experimento; aumentar escala no cambia la pregunta científica.</div></div>
          <div className="two-col">{presets.map((preset) => <div className="card panel" key={preset.slug}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}><div><div className="eyebrow">{categoryLabel(preset.category)}</div><h2 style={{ marginTop: 7 }}>{preset.name}</h2></div><span className="badge">{preset.engine_version}</span></div><p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.65 }}>{preset.description}</p><div className="meta-row" style={{ marginTop: 14 }}><span>Default <strong>{compact(preset.default_iterations)}</strong></span><span>Escala sugerida <strong>{compact(preset.max_recommended_iterations)}</strong></span></div><details style={{ marginTop: 14 }}><summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>Configuración base</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "var(--muted)", marginTop: 10 }}>{JSON.stringify(preset.default_config, null, 2)}</pre></details></div>)}</div>
        </section>

        <section className="section two-col">
          <div className="card panel"><div className="eyebrow">REGLA DE CÓMPUTO</div><h2 style={{ marginTop: 7 }}>Exacto primero, simulación después</h2><p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.65 }}>Cuando un evento puede calcularse combinatoriamente, ése es el benchmark. Monte Carlo se usa para validar, estudiar distribuciones y escalar a experimentos donde enumerar todo deja de ser práctico.</p></div>
          <div className="card panel"><div className="eyebrow">PREMIOS</div><h2 style={{ marginTop: 7 }}>2 · 3 · 4 · 5 separados</h2><p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.65 }}>V2 distingue probabilidad de que una cartera consiga al menos un premio de cada nivel, máximo exacto 2/3/4/5 y cantidad esperada de tickets en cada categoría. No mezcla probabilidad con expectativa.</p></div>
        </section>

        <section className="section"><div className="section-head"><div><div className="eyebrow">PROSPECTIVO</div><h2>Shadows congelados</h2></div></div><div className="table-wrap"><table><thead><tr><th>Target</th><th>Controles</th><th>Geometría</th><th>Generador</th><th>SHA-256</th></tr></thead><tbody>{shadows.map((row) => <tr key={row.id}><td><strong>{row.target_draw_number}</strong></td><td>{row.shadow_count}</td><td>{row.geometry_template}</td><td>{row.generator_version}</td><td style={{ fontFamily: "monospace", fontSize: 10 }}>{row.batch_sha256?.slice(0, 16)}…</td></tr>)}</tbody></table></div></section>

        <section className="section">
          <div className="section-head"><div><div className="eyebrow">REGISTRO</div><h2>Experimentos</h2></div><div className="section-desc">Abrí cualquier corrida para ver métricas, distribuciones, tickets del optimizador, chunks y hashes.</div></div>
          <div className="table-wrap"><table><thead><tr><th>Experimento</th><th>Tipo</th><th>Iteraciones</th><th>Estado</th><th>Hash</th></tr></thead><tbody>{experiments.length === 0 ? <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Sin experimentos.</td></tr> : experiments.map((row) => <tr key={row.id}><td><Link href={`/simulaciones/${row.id}`} style={{ color: "var(--text)", textDecoration: "none" }}><strong>{row.name}</strong><div style={{ color: "var(--accent)", fontSize: 10, marginTop: 2 }}>Abrir resultados →</div></Link><div style={{ color: "var(--muted)", fontSize: 10 }}>{row.slug}</div></td><td>{categoryLabel(row.category)}</td><td>{compact(row.requested_iterations)}</td><td><span className={row.status === "COMPLETED" ? "badge official" : "badge"}>{row.status}</span></td><td style={{ fontFamily: "monospace", fontSize: 10 }}>{row.experiment_sha256 ? `${row.experiment_sha256.slice(0, 12)}…` : "—"}</td></tr>)}</tbody></table></div>
        </section>
      </div>
    </main>
  );
}
