import Link from "next/link";
import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Metric = {
  metric_name: string;
  metric_value: number | null;
  standard_error: number | null;
  quantiles: Record<string, unknown>;
  details: Record<string, unknown>;
  computed_at: string;
};

type Histogram = {
  metric_name: string;
  bin_edges: number[];
  counts: number[];
  total_count: number | string;
};

function compact(value: number | string | null | undefined) {
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function fmt(value: number | null | undefined, percent = false) {
  if (value == null || Number.isNaN(value)) return "—";
  if (percent) return new Intl.NumberFormat("es-AR", { style: "percent", minimumFractionDigits: 3, maximumFractionDigits: 6 }).format(value);
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 8 }).format(value);
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Argentina/Cordoba" }).format(new Date(value));
}

function parseMetric(name: string) {
  const parts = name.split(".");
  if (parts.length >= 3 && (parts[0] === "event" || parts[0] === "expectation")) {
    return { semantics: parts[0], family: parts[1], metric: parts.slice(2).join(".") };
  }
  return { semantics: "legacy", family: parts[0] ?? "other", metric: parts.slice(1).join(".") || name };
}

function humanFamily(value: string) {
  const labels: Record<string, string> = {
    k6_edge_15: "K6 Edge‑15",
    wheel_6: "Wheel‑6",
    disjoint_6: "Disjoint‑6",
    selection_shadow: "Selection Shadow",
    optimizer_best: "Optimizer Best",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function humanMetric(value: string) {
  return value
    .replace(/^at_least_/, "≥ ")
    .replace(/^max_exactly_/, "máximo = ")
    .replace(/^exactly_/, "exactamente ")
    .replace(/^multiple_/, "múltiples ")
    .replaceAll("_", " ");
}

function eventMatrix(metrics: Metric[]) {
  const map = new Map<string, Record<string, number>>();
  for (const row of metrics) {
    if (row.metric_value == null) continue;
    const parsed = parseMetric(row.metric_name);
    if (parsed.semantics !== "event") continue;
    const current = map.get(parsed.family) ?? {};
    current[parsed.metric] = row.metric_value;
    map.set(parsed.family, current);
  }
  return [...map.entries()];
}

function expectationMatrix(metrics: Metric[]) {
  const map = new Map<string, Record<string, number>>();
  for (const row of metrics) {
    if (row.metric_value == null) continue;
    const parsed = parseMetric(row.metric_name);
    if (parsed.semantics !== "expectation") continue;
    const current = map.get(parsed.family) ?? {};
    current[parsed.metric] = row.metric_value;
    map.set(parsed.family, current);
  }
  return [...map.entries()];
}

function HistogramBars({ histogram }: { histogram: Histogram }) {
  const total = Number(histogram.total_count || 0);
  const max = Math.max(1, ...histogram.counts.map(Number));
  return (
    <div className="card panel">
      <div className="eyebrow">DISTRIBUCIÓN</div>
      <h2 style={{ marginTop: 6, fontSize: 18 }}>{histogram.metric_name}</h2>
      <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
        {histogram.bin_edges.map((edge, index) => {
          const count = Number(histogram.counts[index] ?? 0);
          const width = (count / max) * 100;
          return (
            <div key={`${histogram.metric_name}-${edge}`} style={{ display: "grid", gridTemplateColumns: "42px 1fr 86px", gap: 9, alignItems: "center", fontSize: 11 }}>
              <strong>{edge}</strong>
              <div style={{ height: 7, borderRadius: 20, background: "#09111a", overflow: "hidden" }}>
                <div style={{ width: `${width}%`, height: "100%", background: "var(--accent)" }} />
              </div>
              <span style={{ color: "var(--muted)", textAlign: "right" }}>{total ? fmt(count / total, true) : "—"}</span>
            </div>
          );
        })}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 10, marginTop: 12 }}>n = {compact(total)}</div>
    </div>
  );
}

export default async function SimulationExperimentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createPublicClient();
  const [experimentRes, metricsRes, histogramRes, chunksRes, jobsRes] = await Promise.all([
    supabase.from("simulation_experiments").select("*").eq("id", id).maybeSingle(),
    supabase.from("simulation_metrics").select("metric_name,metric_value,standard_error,quantiles,details,computed_at").eq("simulation_experiment_id", id).order("metric_name"),
    supabase.from("simulation_histograms").select("metric_name,bin_edges,counts,total_count").eq("simulation_experiment_id", id).order("metric_name"),
    supabase.from("simulation_chunks").select("chunk_index,iterations,seed_start,status,runtime_ms,result_sha256,created_at,started_at,completed_at").eq("simulation_experiment_id", id).order("chunk_index"),
    supabase.from("simulation_jobs").select("id,status,requested_iterations,progress_iterations,seed_base,worker_id,attempt,runtime_ms,result_summary,result_sha256,error_code,error_message,created_at,started_at,completed_at").eq("simulation_experiment_id", id).order("created_at", { ascending: false }),
  ]);

  if (experimentRes.error) throw new Error(experimentRes.error.message);
  if (!experimentRes.data) notFound();
  const errors = [metricsRes.error, histogramRes.error, chunksRes.error, jobsRes.error].filter(Boolean);
  if (errors.length) throw new Error(errors.map((e) => e?.message).join(" | "));

  const experiment = experimentRes.data;
  const metrics = (metricsRes.data ?? []) as Metric[];
  const histograms = (histogramRes.data ?? []) as Histogram[];
  const chunks = chunksRes.data ?? [];
  const jobs = jobsRes.data ?? [];
  const eventRows = eventMatrix(metrics);
  const expectationRows = expectationMatrix(metrics);
  const latestJob = jobs[0];
  const optimizer = latestJob?.result_summary && typeof latestJob.result_summary === "object" ? (latestJob.result_summary as Record<string, unknown>).optimizer as Record<string, unknown> | undefined : undefined;
  const optimizerTickets = optimizer && Array.isArray(optimizer.tickets) ? optimizer.tickets as number[][] : [];
  const optimizerScore = optimizer && optimizer.score && typeof optimizer.score === "object" ? optimizer.score as Record<string, unknown> : null;
  const maxHitHistograms = histograms.filter((row) => row.metric_name.includes("max_hits")).slice(0, 6);

  return (
    <main>
      <div className="shell">
        <div style={{ marginTop: 36 }}><Link href="/simulaciones" style={{ color: "var(--muted)", fontSize: 12 }}>← Volver a Simulaciones</Link></div>

        <section className="hero" style={{ paddingTop: 30 }}>
          <div>
            <div className="eyebrow">EXPERIMENT RESULT · {experiment.engine_version}</div>
            <h1 style={{ fontSize: "clamp(38px,6vw,76px)" }}>{experiment.name}</h1>
            <p>{experiment.hypothesis ?? "Experimento de simulación reproducible."}</p>
          </div>
          <div className="hero-note">
            <strong>{experiment.status}</strong>
            <span>{experiment.preset_slug ?? experiment.category}</span>
            <div className="meta-row" style={{ marginTop: 13 }}><span>Seed <strong>{experiment.seed_base}</strong></span><span>Iteraciones <strong>{compact(experiment.requested_iterations)}</strong></span></div>
          </div>
        </section>

        <section className="grid-kpi">
          <div className="card kpi"><div className="kpi-label">Estado</div><div className="kpi-value" style={{ fontSize: 24 }}>{experiment.status}</div><div className="kpi-sub">{dateTime(experiment.completed_at ?? experiment.created_at)}</div></div>
          <div className="card kpi"><div className="kpi-label">Iteraciones</div><div className="kpi-value">{compact(experiment.requested_iterations)}</div><div className="kpi-sub">escala solicitada</div></div>
          <div className="card kpi"><div className="kpi-label">Chunks</div><div className="kpi-value">{chunks.length}</div><div className="kpi-sub">unidades reproducibles</div></div>
          <div className="card kpi"><div className="kpi-label">Métricas</div><div className="kpi-value">{metrics.length}</div><div className="kpi-sub">agregados persistidos</div></div>
          <div className="card kpi"><div className="kpi-label">Engine</div><div className="kpi-value" style={{ fontSize: 20 }}>{experiment.engine_version}</div><div className="kpi-sub">commit {String(experiment.git_commit_sha).slice(0, 9)}</div></div>
        </section>

        {eventRows.length > 0 && (
          <section className="section">
            <div className="section-head"><div><div className="eyebrow">EVENT PROBABILITIES</div><h2>Probabilidad de cobrar por nivel</h2></div><div className="section-desc">P(al menos un ticket con ≥2, ≥3, ≥4 o 5 aciertos). Esto es una probabilidad de evento de cartera, no cantidad esperada de tickets.</div></div>
            <div className="table-wrap"><table><thead><tr><th>Geometría</th><th>≥2</th><th>≥3</th><th>≥4</th><th>5</th><th>Máx=2</th><th>Máx=3</th><th>Máx=4</th></tr></thead><tbody>{eventRows.map(([family, values]) => <tr key={family}><td><strong>{humanFamily(family)}</strong></td><td>{fmt(values.at_least_2, true)}</td><td>{fmt(values.at_least_3, true)}</td><td>{fmt(values.at_least_4, true)}</td><td>{fmt(values.at_least_5, true)}</td><td>{fmt(values.max_exactly_2, true)}</td><td>{fmt(values.max_exactly_3, true)}</td><td>{fmt(values.max_exactly_4, true)}</td></tr>)}</tbody></table></div>
          </section>
        )}

        {expectationRows.length > 0 && (
          <section className="section">
            <div className="section-head"><div><div className="eyebrow">TICKET EXPECTATIONS</div><h2>Tickets esperados por sorteo</h2></div><div className="section-desc">Cantidad media de tickets de la cartera que caen exactamente en cada categoría. Puede ser mayor que una probabilidad porque una misma corrida puede producir varios tickets premiados.</div></div>
            <div className="table-wrap"><table><thead><tr><th>Geometría</th><th>Exactos 2</th><th>Exactos 3</th><th>Exactos 4</th><th>Exactos 5</th><th>Tickets 2+</th><th>Tickets 3+</th><th>Tickets 4+</th></tr></thead><tbody>{expectationRows.map(([family, values]) => <tr key={family}><td><strong>{humanFamily(family)}</strong></td><td>{fmt(values.exactly_2)}</td><td>{fmt(values.exactly_3)}</td><td>{fmt(values.exactly_4)}</td><td>{fmt(values.exactly_5)}</td><td>{fmt(values.at_least_2)}</td><td>{fmt(values.at_least_3)}</td><td>{fmt(values.at_least_4)}</td></tr>)}</tbody></table></div>
          </section>
        )}

        {optimizerTickets.length > 0 && (
          <section className="section">
            <div className="section-head"><div><div className="eyebrow">OPTIMIZER RESULT</div><h2>Mejor cartera encontrada</h2></div><div className="section-desc">Búsqueda geométrica reproducible; no implica que los números elegidos tengan mayor probabilidad individual.</div></div>
            <div className="two-col">
              <div className="card panel"><div className="eyebrow">TICKETS</div><div style={{ display: "grid", gap: 10, marginTop: 14 }}>{optimizerTickets.map((ticket, index) => <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="badge">{index + 1}</span><strong style={{ letterSpacing: ".12em" }}>{ticket.map((n) => String(n).padStart(2, "0")).join(" · ")}</strong></div>)}</div></div>
              <div className="card panel"><div className="eyebrow">GEOMETRÍA</div><div style={{ display: "grid", gap: 11, marginTop: 14 }}>{optimizerScore ? Object.entries(optimizerScore).filter(([key]) => key !== "usage").map(([key, value]) => <div key={key} className="meta-row"><span>{humanMetric(key)}</span><strong>{String(value)}</strong></div>) : null}</div></div>
            </div>
          </section>
        )}

        {maxHitHistograms.length > 0 && (
          <section className="section"><div className="section-head"><div><div className="eyebrow">HISTOGRAMS</div><h2>Distribución del máximo de aciertos</h2></div></div><div className="two-col">{maxHitHistograms.map((row) => <HistogramBars key={row.metric_name} histogram={row} />)}</div></section>
        )}

        <section className="section">
          <div className="section-head"><div><div className="eyebrow">AUDIT TRAIL</div><h2>Chunks y hashes</h2></div><div className="section-desc">Cada unidad mantiene seed, runtime y SHA‑256. Esto permite reproducir y auditar una corrida sin guardar cada universo sintético.</div></div>
          <div className="table-wrap"><table><thead><tr><th>Chunk</th><th>Iteraciones</th><th>Seed</th><th>Runtime</th><th>Estado</th><th>SHA‑256</th></tr></thead><tbody>{chunks.length === 0 ? <tr><td colSpan={6} style={{ color: "var(--muted)" }}>Sin chunks persistidos.</td></tr> : chunks.map((row) => <tr key={row.chunk_index}><td>{row.chunk_index}</td><td>{compact(row.iterations)}</td><td>{row.seed_start}</td><td>{row.runtime_ms == null ? "—" : `${(Number(row.runtime_ms) / 1000).toFixed(2)} s`}</td><td><span className={row.status === "COMPLETED" ? "badge official" : "badge"}>{row.status}</span></td><td style={{ fontFamily: "monospace", fontSize: 10 }}>{row.result_sha256 ? `${row.result_sha256.slice(0, 18)}…` : "—"}</td></tr>)}</tbody></table></div>
        </section>

        {eventRows.length === 0 && expectationRows.length === 0 && metrics.length > 0 && (
          <section className="section"><div className="section-head"><div><div className="eyebrow">LEGACY / GENERIC METRICS</div><h2>Métricas registradas</h2></div></div><div className="table-wrap"><table><thead><tr><th>Métrica</th><th>Valor</th><th>SE</th></tr></thead><tbody>{metrics.map((row) => <tr key={row.metric_name}><td>{row.metric_name}</td><td>{fmt(row.metric_value)}</td><td>{fmt(row.standard_error)}</td></tr>)}</tbody></table></div></section>
        )}

        <section className="section two-col">
          <div className="card panel"><div className="eyebrow">CONFIG</div><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--muted)", fontSize: 10 }}>{JSON.stringify(experiment.config, null, 2)}</pre></div>
          <div className="card panel"><div className="eyebrow">HASHES</div><div style={{ display: "grid", gap: 11, marginTop: 12, fontFamily: "monospace", fontSize: 10 }}><div>experiment<br />{experiment.experiment_sha256 ?? "—"}</div><div>latest result<br />{latestJob?.result_sha256 ?? "—"}</div><div>git<br />{experiment.git_commit_sha}</div></div></div>
        </section>
      </div>
    </main>
  );
}
