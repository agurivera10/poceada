import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const actionsUrl = "https://github.com/agurivera10/poceada/actions/workflows/simulation-lab.yml";

function compact(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function categoryLabel(value: string) {
  const labels: Record<string, string> = {
    PORTFOLIO_GEOMETRY: "Geometría",
    NULL_HISTORY: "Historia nula",
    SELECTION_SHADOW: "Shadows",
    MULTIPLE_TESTING: "Red team",
    BANKROLL: "Riesgo económico",
    RANDOMNESS: "Aleatoriedad",
    CUSTOM: "Custom",
  };
  return labels[value] ?? value;
}

export default async function SimulacionesPage() {
  const supabase = createPublicClient();
  const [statusRes, presetsRes, experimentsRes, shadowRes] = await Promise.all([
    supabase.from("simulation_lab_status").select("*").maybeSingle(),
    supabase.from("simulation_presets").select("slug,name,category,description,engine_version,default_iterations,max_recommended_iterations,default_config").eq("active", true).order("name"),
    supabase.from("simulation_experiments").select("id,slug,name,category,status,requested_iterations,shard_count,experiment_sha256,created_at,completed_at").order("created_at", { ascending: false }).limit(12),
    supabase.from("shadow_batches").select("id,target_draw_number,shadow_count,generator_version,geometry_template,batch_sha256,frozen_at").order("target_draw_number", { ascending: false }).limit(3),
  ]);

  const errors = [statusRes.error, presetsRes.error, experimentsRes.error, shadowRes.error].filter(Boolean);
  if (errors.length) throw new Error(errors.map((e) => e?.message).join(" | "));

  const status = statusRes.data ?? {
    active_presets: 0,
    experiments: 0,
    completed_experiments: 0,
    completed_iterations: 0,
    completed_chunks: 0,
    materialized_shadows: 0,
    shadow_evaluations: 0,
  };
  const presets = presetsRes.data ?? [];
  const experiments = experimentsRes.data ?? [];
  const shadows = shadowRes.data ?? [];

  return (
    <main>
      <div className="shell">
        <section className="hero">
          <div>
            <div className="eyebrow">SIMULATION LAB V1</div>
            <h1>Millones de universos, una sola regla: reproducibilidad.</h1>
            <p>
              Laboratorio para Monte Carlo masivo, temporadas nulas, red-team estadístico, shadows de selección y riesgo económico. Las corridas grandes se dividen en 8 shards deterministas y cada resultado termina con un SHA-256 verificable.
            </p>
          </div>
          <div className="hero-note">
            <strong>Escala sin ensuciar la evidencia</strong>
            <span>Las simulaciones exploratorias viven separadas del experimento prospectivo. Un resultado simulado nunca modifica una predicción ya congelada.</span>
            <a href={actionsUrl} target="_blank" rel="noreferrer" style={{ marginTop: 12, display: "inline-block", color: "var(--accent)" }}>
              Ejecutar corrida masiva en GitHub Actions →
            </a>
          </div>
        </section>

        <section className="grid-kpi">
          <div className="card kpi"><div className="kpi-label">Presets activos</div><div className="kpi-value">{status.active_presets}</div><div className="kpi-sub">familias de experimentos</div></div>
          <div className="card kpi"><div className="kpi-label">Experimentos</div><div className="kpi-value">{status.experiments}</div><div className="kpi-sub">{status.completed_experiments} completados</div></div>
          <div className="card kpi"><div className="kpi-label">Iteraciones completas</div><div className="kpi-value">{compact(status.completed_iterations)}</div><div className="kpi-sub">acumuladas en Supabase</div></div>
          <div className="card kpi"><div className="kpi-label">Shadows</div><div className="kpi-value">{compact(status.materialized_shadows)}</div><div className="kpi-sub">controles materializados</div></div>
          <div className="card kpi"><div className="kpi-label">Chunks completos</div><div className="kpi-value">{status.completed_chunks}</div><div className="kpi-sub">unidades reproducibles</div></div>
        </section>

        <section className="section">
          <div className="section-head">
            <div><div className="eyebrow">Experiment designer</div><h2>Qué podemos simular</h2></div>
            <div className="section-desc">Cada preset fija una pregunta científica. La escala puede aumentarse sin cambiar el significado del experimento.</div>
          </div>
          <div className="two-col">
            {presets.map((preset) => (
              <div className="card panel" key={preset.slug}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div><div className="eyebrow">{categoryLabel(preset.category)}</div><h2 style={{ marginTop: 7 }}>{preset.name}</h2></div>
                  <span className="badge">{preset.engine_version}</span>
                </div>
                <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.65 }}>{preset.description}</p>
                <div className="meta-row" style={{ marginTop: 14 }}>
                  <span>Default <strong>{compact(preset.default_iterations)}</strong></span>
                  <span>Escala V1 <strong>{compact(preset.max_recommended_iterations)}</strong></span>
                </div>
                <details style={{ marginTop: 14 }}>
                  <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>Configuración base</summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "var(--muted)", marginTop: 10 }}>{JSON.stringify(preset.default_config, null, 2)}</pre>
                </details>
              </div>
            ))}
          </div>
        </section>

        <section className="section two-col">
          <div className="card panel">
            <div className="eyebrow">Motor masivo</div>
            <h2 style={{ marginTop: 7 }}>8 shards paralelos</h2>
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.65 }}>
              GitHub Actions divide la cantidad total de iteraciones en ocho procesos independientes. Cada shard recibe una semilla derivada, produce histogramas y contadores, y el merge final combina resultados sin guardar millones de sorteos individuales.
            </p>
            <div className="meta-row" style={{ marginTop: 14 }}><span>NumPy <strong>2.5.3</strong></span><span>RNG <strong>PCG64</strong></span><span>Hash <strong>SHA-256</strong></span></div>
          </div>
          <div className="card panel">
            <div className="eyebrow">Regla de cómputo</div>
            <h2 style={{ marginTop: 7 }}>Exacto primero, Monte Carlo después</h2>
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.65 }}>
              Cuando una probabilidad puede calcularse combinatoriamente, ése es el benchmark. La simulación sirve para validarla, estudiar distribuciones más complejas y atacar escenarios donde la enumeración exacta deja de ser práctica.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="section-head"><div><div className="eyebrow">Prospectivo</div><h2>Shadows congelados</h2></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Target</th><th>Controles</th><th>Geometría</th><th>Generador</th><th>SHA-256</th></tr></thead>
              <tbody>
                {shadows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.target_draw_number}</strong></td>
                    <td>{row.shadow_count}</td>
                    <td>{row.geometry_template}</td>
                    <td>{row.generator_version}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 10 }}>{row.batch_sha256?.slice(0, 16)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section">
          <div className="section-head"><div><div className="eyebrow">Registro</div><h2>Corridas masivas</h2></div><div className="section-desc">Supabase guarda definición, cantidad de iteraciones, chunks, métricas, histogramas y hashes; no una montaña de filas sintéticas.</div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Experimento</th><th>Tipo</th><th>Iteraciones</th><th>Shards</th><th>Estado</th><th>Hash</th></tr></thead>
              <tbody>
                {experiments.length === 0 ? (
                  <tr><td colSpan={6} style={{ color: "var(--muted)" }}>Todavía no hay una corrida masiva importada. El motor ya está listo para la primera.</td></tr>
                ) : experiments.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.name}</strong><div style={{ color: "var(--muted)", fontSize: 10 }}>{row.slug}</div></td>
                    <td>{categoryLabel(row.category)}</td>
                    <td>{compact(row.requested_iterations)}</td>
                    <td>{row.shard_count}</td>
                    <td><span className={row.status === "COMPLETED" ? "badge official" : "badge"}>{row.status}</span></td>
                    <td style={{ fontFamily: "monospace", fontSize: 10 }}>{row.experiment_sha256 ? `${row.experiment_sha256.slice(0, 12)}…` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
