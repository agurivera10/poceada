import Link from "next/link";
import { DecisionSummary } from "@/components/decision-summary";
import { SimulationControl } from "@/components/simulation-control";
import { isLabAdmin } from "@/lib/lab-auth";
import { createPublicClient } from "@/lib/supabase";
import "./decision.css";

export const dynamic = "force-dynamic";

function compact(value: number | string | null | undefined) {
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

function categoryLabel(value: string) {
  const labels: Record<string, string> = {
    PORTFOLIO_GEOMETRY: "Geometría de tickets",
    NULL_HISTORY: "Universos nulos",
    SELECTION_SHADOW: "Control de selección",
    MULTIPLE_TESTING: "Red team estadístico",
    BANKROLL: "Riesgo económico",
    RANDOMNESS: "Aleatoriedad",
    OPTIMIZATION: "Optimización",
    CUSTOM: "Personalizado",
  };
  return labels[value] ?? value;
}

function purposeFor(category: string) {
  const purposes: Record<string, string> = {
    PORTFOLIO_GEOMETRY: "Comparar cómo repartir el mismo presupuesto entre tickets.",
    NULL_HISTORY: "Saber qué patrones aparecen normalmente aunque todo sea azar.",
    SELECTION_SHADOW: "Medir si nuestro selector supera controles aleatorios equivalentes.",
    MULTIPLE_TESTING: "Detectar cuánto éxito aparente puede venir de probar demasiadas ideas.",
    OPTIMIZATION: "Buscar automáticamente carteras con mejor cobertura para un objetivo concreto.",
    RANDOMNESS: "Examinar uniformidad, dependencias y estabilidad temporal.",
    BANKROLL: "Traducir premios reales a retorno, volatilidad y riesgo cuando ECON-V1 esté activo.",
  };
  return purposes[category] ?? "Responder una pregunta científica concreta.";
}

export default async function SimulacionesPage() {
  const supabase = createPublicClient();
  const [statusRes, computeRes, presetsRes, experimentsRes, shadowRes, jobsRes, workersRes, authorized] = await Promise.all([
    supabase.from("simulation_lab_status").select("*").maybeSingle(),
    supabase.from("simulation_compute_status").select("*").maybeSingle(),
    supabase.from("simulation_presets").select("slug,name,category,description,engine_version,default_iterations,max_recommended_iterations,default_config").eq("active", true).order("name"),
    supabase.from("simulation_experiments").select("id,slug,name,category,status,requested_iterations,shard_count,experiment_sha256,created_at,completed_at").neq("status", "ABORTED").order("created_at", { ascending: false }).limit(24),
    supabase.from("shadow_batches").select("id,target_draw_number,shadow_count,generator_version,geometry_template,batch_sha256,frozen_at").order("target_draw_number", { ascending: false }).limit(3),
    supabase.from("simulation_jobs").select("id,simulation_experiment_id,preset_slug,status,priority,requested_iterations,progress_iterations,seed_base,current_phase,worker_id,attempt,cancel_requested,result_sha256,error_message,created_at,started_at,completed_at").neq("status", "CANCELLED").order("created_at", { ascending: false }).limit(40),
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

  const geometryExperiments = experiments
    .filter((row) => row.status === "COMPLETED" && row.category === "PORTFOLIO_GEOMETRY")
    .sort((a, b) => Number(b.requested_iterations) - Number(a.requested_iterations) || +new Date(b.completed_at ?? b.created_at) - +new Date(a.completed_at ?? a.created_at));
  const latestDecisionExperiment = geometryExperiments[0];

  let decisionMetrics: Array<{ metric_name: string; metric_value: number | null }> = [];
  if (latestDecisionExperiment) {
    const metricsRes = await supabase
      .from("simulation_metrics")
      .select("metric_name,metric_value")
      .eq("simulation_experiment_id", latestDecisionExperiment.id)
      .like("metric_name", "event.%")
      .order("metric_name");
    if (metricsRes.error) throw new Error(metricsRes.error.message);
    decisionMetrics = metricsRes.data ?? [];
  }

  const totalIterations = Number(status.completed_iterations);
  const precisionNext = latestDecisionExperiment && Number(latestDecisionExperiment.requested_iterations) < 10_000_000;

  return (
    <main>
      <div className="shell">
        <section className="hero decision-hero">
          <div>
            <div className="eyebrow">SIMULATION LAB · DECISION MODE</div>
            <h1>Decidir primero. Simular después.</h1>
            <p>Compará estrategias con el mismo presupuesto y elegí según el objetivo: cobrar más seguido, buscar 3+, maximizar 4+ o concentrar múltiples premios. La infraestructura queda atrás; arriba mostramos lo que cambia una decisión.</p>
          </div>
          <div className="hero-note decision-status">
            <strong>Estado del laboratorio</strong>
            <div className="decision-status-line"><span>Compute Python</span><b>{compute.active_jobs > 0 ? "EJECUTANDO" : "ON‑DEMAND"}</b></div>
            <div className="decision-status-line"><span>Evidencia usada</span><b>{latestDecisionExperiment ? compact(latestDecisionExperiment.requested_iterations) : "—"}</b></div>
            <div className="decision-status-line"><span>Presupuesto base</span><b>6 tickets · $12.000</b></div>
          </div>
        </section>

        <section className="grid-kpi">
          <div className="card kpi"><div className="kpi-label">Cartera comparable</div><div className="kpi-value" style={{ fontSize: 25 }}>6 tickets</div><div className="kpi-sub">$12.000 al precio actual</div></div>
          <div className="card kpi"><div className="kpi-label">Experimentos útiles</div><div className="kpi-value">{status.completed_experiments}</div><div className="kpi-sub">corridas completadas</div></div>
          <div className="card kpi"><div className="kpi-label">Universos simulados</div><div className="kpi-value">{compact(totalIterations)}</div><div className="kpi-sub">completados</div></div>
          <div className="card kpi"><div className="kpi-label">Compute</div><div className="kpi-value" style={{ fontSize: 23 }}>ON‑DEMAND</div><div className="kpi-sub">{compute.active_jobs} activos · {compute.queued_jobs} en cola</div></div>
          <div className="card kpi"><div className="kpi-label">Controles</div><div className="kpi-value">{compact(status.materialized_shadows)}</div><div className="kpi-sub">shadows prospectivos</div></div>
        </section>

        {latestDecisionExperiment ? (
          <DecisionSummary
            metrics={decisionMetrics}
            iterations={Number(latestDecisionExperiment.requested_iterations)}
            experimentName={latestDecisionExperiment.name}
            experimentId={latestDecisionExperiment.id}
          />
        ) : (
          <section className="section"><div className="alert"><div className="alert-dot" /><div><strong>Todavía no hay una corrida de geometría para decidir.</strong><p>Ejecutá Portfolio Null Geometry para generar el primer comparador 2+/3+/4+/5 con presupuesto constante.</p></div></div></section>
        )}

        <section className="section">
          <div className="section-head">
            <div><div className="eyebrow">SIGUIENTE DECISIÓN</div><h2>Qué haría ahora</h2></div>
            <div className="section-desc">El laboratorio no debería producir más datos porque sí. Cada corrida tiene que reducir una incertidumbre concreta.</div>
          </div>
          <div className="decision-next-grid">
            <div className="card decision-next-card primary">
              <span>01</span><strong>{precisionNext ? "Subir precisión de geometría" : "Geometría con buena escala"}</strong>
              <p>{precisionNext ? "La corrida actual es diagnóstica. El próximo salto útil es 10M para estabilizar 4+ y comparar carteras sin sobreleer ruido de Monte Carlo." : "Ya tenemos al menos 10M para la comparación geométrica. El siguiente cuello de botella pasa a optimización por objetivo, selección y economía."}</p>
            </div>
            <div className="card decision-next-card"><span>02</span><strong>Optimizar para un objetivo</strong><p>En vez de buscar “la mejor cartera” en abstracto, elegir una función: P(2+), P(3+), P(4+), múltiples premios o una combinación ponderada.</p></div>
            <div className="card decision-next-card"><span>03</span><strong>Agregar economía real</strong><p>Cuando tengamos payouts oficiales completos de 2/3/4/5, comparar frecuencia de cobro con retorno esperado, recuperación de costo y drawdown.</p></div>
          </div>
        </section>

        <SimulationControl presets={presets} initialJobs={jobs} initialWorkers={workers} initialAuthorized={authorized} />

        <section className="section">
          <div className="section-head"><div><div className="eyebrow">QUÉ PREGUNTA RESPONDE CADA EXPERIMENTO</div><h2>Elegí por pregunta, no por nombre técnico</h2></div></div>
          <div className="experiment-purpose-grid">
            {presets.map((preset) => (
              <div className="card purpose-card" key={preset.slug}>
                <div className="eyebrow">{categoryLabel(preset.category)}</div>
                <h3>{preset.name}</h3>
                <strong>{purposeFor(preset.category)}</strong>
                <p>{preset.description}</p>
                <div className="meta-row"><span>Default <strong>{compact(preset.default_iterations)}</strong></span><span>Escala sugerida <strong>{compact(preset.max_recommended_iterations)}</strong></span></div>
              </div>
            ))}
          </div>
        </section>

        <section className="section two-col">
          <div className="card panel"><div className="eyebrow">REGLA DE DECISIÓN</div><h2 style={{ marginTop: 7 }}>Exacto primero, simulación después</h2><p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.65 }}>Si algo puede calcularse exactamente, ése es el benchmark. Monte Carlo agrega distribución, sensibilidad y escala; no reemplaza una cuenta exacta disponible.</p></div>
          <div className="card panel"><div className="eyebrow">PREMIOS</div><h2 style={{ marginTop: 7 }}>2 · 3 · 4 · 5 son objetivos distintos</h2><p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.65 }}>Una geometría puede cobrar más seguido y otra concentrar premios grandes. Por eso la interfaz evita una recomendación única y muestra la mejor observada para cada objetivo.</p></div>
        </section>

        <section className="section"><div className="section-head"><div><div className="eyebrow">PROSPECTIVO</div><h2>Shadows congelados</h2></div><div className="section-desc">Controles aleatorios preregistrados para saber cuándo un resultado parece mejor que azar equivalente.</div></div><div className="table-wrap"><table><thead><tr><th>Target</th><th>Controles</th><th>Geometría</th><th>Generador</th><th>SHA-256</th></tr></thead><tbody>{shadows.map((row) => <tr key={row.id}><td><strong>{row.target_draw_number}</strong></td><td>{row.shadow_count}</td><td>{row.geometry_template}</td><td>{row.generator_version}</td><td style={{ fontFamily: "monospace", fontSize: 10 }}>{row.batch_sha256?.slice(0, 16)}…</td></tr>)}</tbody></table></div></section>

        <section className="section">
          <div className="section-head"><div><div className="eyebrow">HISTORIAL</div><h2>Corridas anteriores</h2></div><div className="section-desc">Abrí una corrida sólo cuando necesites auditar detalle, distribuciones o hashes.</div></div>
          <div className="table-wrap"><table><thead><tr><th>Experimento</th><th>Pregunta</th><th>Iteraciones</th><th>Estado</th><th>Resultado</th></tr></thead><tbody>{experiments.length === 0 ? <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Sin experimentos.</td></tr> : experiments.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><div style={{ color: "var(--muted)", fontSize: 10 }}>{row.slug}</div></td><td>{categoryLabel(row.category)}</td><td>{compact(row.requested_iterations)}</td><td><span className={row.status === "COMPLETED" ? "badge official" : "badge"}>{row.status}</span></td><td><Link href={`/simulaciones/${row.id}`} className="decision-link">Ver →</Link></td></tr>)}</tbody></table></div>
        </section>
      </div>
    </main>
  );
}
