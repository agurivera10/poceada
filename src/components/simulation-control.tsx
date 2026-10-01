"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPublicClient } from "@/lib/supabase";

type Preset = {
  slug: string;
  name: string;
  category: string;
  description: string;
  engine_version: string;
  default_iterations: number | string;
  max_recommended_iterations: number | string;
  default_config: Record<string, unknown>;
};

type Job = {
  id: string;
  simulation_experiment_id: string;
  preset_slug: string | null;
  status: string;
  priority: number;
  requested_iterations: number | string;
  progress_iterations: number | string;
  seed_base: number | string;
  current_phase: string | null;
  worker_id: string | null;
  attempt: number;
  cancel_requested: boolean;
  result_sha256: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type Worker = {
  id: string;
  display_name: string;
  worker_version: string;
  engine_version: string;
  status: string;
  cpu_count: number | null;
  current_job_id: string | null;
  last_seen_at: string;
  completed_jobs: number;
  failed_jobs: number;
};

const field: CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "#0b121b",
  color: "var(--text)",
  font: "inherit",
};

const smallButton: CSSProperties = {
  border: "1px solid var(--line)",
  background: "#0d1621",
  color: "var(--text)",
  borderRadius: 9,
  padding: "8px 11px",
  cursor: "pointer",
  fontSize: 11,
};

const purpose: Record<string, string> = {
  PORTFOLIO_GEOMETRY: "Comparar cómo repartir el mismo presupuesto entre tickets.",
  NULL_HISTORY: "Medir qué patrones aparecen normalmente aunque todo sea azar.",
  SELECTION_SHADOW: "Comparar nuestro selector contra miles de selecciones aleatorias equivalentes.",
  MULTIPLE_TESTING: "Cuantificar cuánto falso descubrimiento genera probar muchas estrategias.",
  OPTIMIZATION: "Buscar automáticamente la geometría de tickets para un objetivo elegido.",
  RANDOMNESS: "Buscar desviaciones de uniformidad o dependencias que resistan controles.",
  BANKROLL: "Simular retorno, drawdown y riesgo con payouts reales.",
};

const scales = [
  { value: 100_000, label: "100K", note: "Prueba rápida" },
  { value: 1_000_000, label: "1M", note: "Diagnóstico" },
  { value: 10_000_000, label: "10M", note: "Recomendado" },
  { value: 100_000_000, label: "100M", note: "Alta precisión" },
  { value: 1_000_000_000, label: "1B", note: "Extrema" },
];

function compact(value: number | string | null | undefined) {
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function percent(job: Job) {
  const total = Number(job.requested_iterations || 0);
  const done = Number(job.progress_iterations || 0);
  return total > 0 ? Math.min(100, (done / total) * 100) : 0;
}

function throughput(job: Job) {
  if (!job.started_at || !["CLAIMED", "RUNNING", "CANCELLING"].includes(job.status)) return null;
  const seconds = Math.max(1, (Date.now() - new Date(job.started_at).getTime()) / 1000);
  const rate = Number(job.progress_iterations || 0) / seconds;
  return rate > 0 ? `${compact(rate)}/s` : null;
}

function humanStatus(status: string) {
  const labels: Record<string, string> = {
    QUEUED: "EN COLA",
    CLAIMED: "TOMADO",
    RUNNING: "CORRIENDO",
    CANCELLING: "CANCELANDO",
    COMPLETED: "COMPLETADO",
    FAILED: "ERROR",
    CANCELLED: "CANCELADO",
    STALE: "INTERRUMPIDO",
  };
  return labels[status] ?? status;
}

export function SimulationControl({ presets, initialJobs, initialWorkers, initialAuthorized }: {
  presets: Preset[];
  initialJobs: Job[];
  initialWorkers: Worker[];
  initialAuthorized: boolean;
}) {
  const supabase = useMemo(() => createPublicClient(), []);
  const preferred = presets.find((p) => p.slug === "portfolio-null-geometry-v1") ?? presets[0];
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [workers, setWorkers] = useState<Worker[]>(initialWorkers);
  const [authorized, setAuthorized] = useState(initialAuthorized);
  const [password, setPassword] = useState("");
  const [presetSlug, setPresetSlug] = useState(preferred?.slug ?? "");
  const [name, setName] = useState("");
  const [iterations, setIterations] = useState(String(preferred?.default_iterations ?? 10_000_000));
  const [seed, setSeed] = useState(String(Date.now()));
  const [priority, setPriority] = useState("50");
  const [configText, setConfigText] = useState(JSON.stringify(preferred?.default_config ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selectedPreset = presets.find((p) => p.slug === presetSlug);

  useEffect(() => {
    const jobsChannel = supabase
      .channel("simulation-jobs-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "simulation_jobs" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const oldRow = payload.old as Partial<Job>;
          setJobs((current) => current.filter((row) => row.id !== oldRow.id));
          return;
        }
        const row = payload.new as Job;
        setJobs((current) => {
          const found = current.some((item) => item.id === row.id);
          const next = found ? current.map((item) => item.id === row.id ? row : item) : [row, ...current];
          return next.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 30);
        });
      })
      .subscribe();

    const workersChannel = supabase
      .channel("simulation-workers-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "simulation_workers" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const oldRow = payload.old as Partial<Worker>;
          setWorkers((current) => current.filter((row) => row.id !== oldRow.id));
          return;
        }
        const row = payload.new as Worker;
        setWorkers((current) => current.some((item) => item.id === row.id) ? current.map((item) => item.id === row.id ? row : item) : [row, ...current]);
      })
      .subscribe();

    const timer = window.setInterval(async () => {
      const { data } = await supabase.from("simulation_workers").select("*").order("last_seen_at", { ascending: false }).limit(12);
      if (data) setWorkers(data as Worker[]);
    }, 15_000);

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(jobsChannel);
      void supabase.removeChannel(workersChannel);
    };
  }, [supabase]);

  function choosePreset(slug: string) {
    setPresetSlug(slug);
    const preset = presets.find((p) => p.slug === slug);
    if (preset) {
      setIterations(String(preset.default_iterations));
      setConfigText(JSON.stringify(preset.default_config ?? {}, null, 2));
    }
  }

  async function login() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/lab/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No autorizado");
      setAuthorized(true);
      setPassword("");
      setMessage("Ejecución habilitada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/lab/logout", { method: "POST" });
    setAuthorized(false);
    setMessage("Sesión cerrada.");
  }

  async function launch() {
    setBusy(true);
    setMessage(null);
    try {
      const config = JSON.parse(configText || "{}");
      const response = await fetch("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, preset: presetSlug, iterations: Number(iterations), seed: Number(seed), priority: Number(priority), config }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo crear la simulación");
      setMessage(`Simulación ${body.job?.id?.slice(0, 8) ?? ""} enviada al compute.`);
      setSeed(String(Number(seed) + 1));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear la simulación.");
    } finally {
      setBusy(false);
    }
  }

  async function mutateJob(id: string, action: "cancel" | "retry") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/simulations/${id}/${action}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Operación fallida");
      setMessage(action === "cancel" ? "Cancelación solicitada." : "Reintento en cola.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operación fallida.");
    } finally {
      setBusy(false);
    }
  }

  const onlineWorkers = workers.filter((worker) => Date.now() - new Date(worker.last_seen_at).getTime() < 5 * 60_000);
  const activeJobs = jobs.filter((job) => ["QUEUED", "CLAIMED", "RUNNING", "CANCELLING"].includes(job.status));

  return (
    <section className="section launch-section">
      <div className="section-head">
        <div><div className="eyebrow">NUEVA PRUEBA</div><h2>Ejecutar una simulación</h2></div>
        <div className="section-desc">Tres decisiones visibles. Seed, prioridad y JSON quedan en avanzado.</div>
      </div>

      <div className="card launch-card">
        <div className="launch-topbar">
          <div className="compute-pill"><span className={onlineWorkers.length > 0 ? "compute-dot online" : "compute-dot"} /><strong>{onlineWorkers.length > 0 ? "Compute disponible" : "Compute sin worker reciente"}</strong><span>{activeJobs.length} activas</span></div>
          {!authorized ? (
            <div className="admin-inline">
              <input style={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Clave admin" onKeyDown={(e) => { if (e.key === "Enter") void login(); }} />
              <button style={smallButton} disabled={busy} onClick={() => void login()}>Desbloquear</button>
            </div>
          ) : <button style={smallButton} onClick={() => void logout()}>Bloquear ejecución</button>}
        </div>

        <div className="launch-steps">
          <div className="launch-step">
            <div className="step-number">1</div>
            <div className="step-body">
              <label>¿Qué querés investigar?</label>
              <select style={field} value={presetSlug} onChange={(e) => choosePreset(e.target.value)}>{presets.map((preset) => <option key={preset.slug} value={preset.slug}>{preset.name}</option>)}</select>
              <p><strong>{purpose[selectedPreset?.category ?? ""] ?? "Experimento científico reproducible."}</strong><br />{selectedPreset?.description}</p>
            </div>
          </div>

          <div className="launch-step">
            <div className="step-number">2</div>
            <div className="step-body">
              <label>¿Cuánta precisión?</label>
              <div className="scale-grid">
                {scales.map((scale) => (
                  <button key={scale.value} type="button" className={Number(iterations) === scale.value ? "scale-choice selected" : "scale-choice"} onClick={() => setIterations(String(scale.value))}>
                    <strong>{scale.label}</strong><span>{scale.note}</span>
                  </button>
                ))}
              </div>
              <div className="scale-help">Seleccionado: <strong>{new Intl.NumberFormat("es-AR").format(Number(iterations || 0))}</strong> universos. Para comparar 4+ con seriedad, 10M es un buen punto de partida.</div>
            </div>
          </div>

          <div className="launch-step final">
            <div className="step-number">3</div>
            <div className="step-body">
              <label>Ejecutar</label>
              <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre opcional, ej. Geometría 10M V2" />
              <button disabled={!authorized || busy || !presetSlug} onClick={() => void launch()} className="launch-button">{busy ? "Procesando…" : authorized ? "▶ Ejecutar simulación" : "Desbloqueá para ejecutar"}</button>
              {message && <div className="launch-message">{message}</div>}
            </div>
          </div>
        </div>

        <details className="advanced-box" open={presetSlug === "portfolio-optimizer-v1"}>
          <summary>Opciones avanzadas · seed, prioridad y configuración</summary>
          <div className="advanced-grid">
            <label>Seed<input style={field} inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} /></label>
            <label>Prioridad 0–100<input style={field} inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value.replace(/\D/g, ""))} /></label>
          </div>
          <textarea style={{ ...field, minHeight: 130, marginTop: 10, fontFamily: "monospace", fontSize: 11 }} value={configText} onChange={(e) => setConfigText(e.target.value)} />
        </details>
      </div>

      <div className="card panel" style={{ marginTop: 16 }}>
        <div className="section-head"><div><div className="eyebrow">ACTIVIDAD</div><h2>Cola y ejecuciones recientes</h2></div><div className="section-desc">Sólo lo operativo: progreso, estado y acción.</div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Simulación</th><th>Escala</th><th>Progreso</th><th>Estado</th><th>Acción</th></tr></thead>
            <tbody>
              {jobs.length === 0 ? <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Todavía no hay jobs lanzados desde la app.</td></tr> : jobs.slice(0, 15).map((job) => {
                const pct = percent(job);
                return (
                  <tr key={job.id}>
                    <td><strong>{job.preset_slug?.replaceAll("-v1", "").replaceAll("-", " ") ?? job.id.slice(0, 8)}</strong><div style={{ fontSize: 10, color: "var(--muted)" }}>#{job.id.slice(0, 8)} · {job.current_phase ?? "—"}</div></td>
                    <td>{compact(job.requested_iterations)}</td>
                    <td style={{ minWidth: 180 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 5 }}><span>{compact(job.progress_iterations)} / {compact(job.requested_iterations)}</span><span>{pct.toFixed(1)}%</span></div>
                      <div style={{ height: 5, background: "#0b121b", borderRadius: 10, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct}%`, background: "var(--green)", transition: "width .3s" }} /></div>
                      {throughput(job) && <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 4 }}>{throughput(job)}</div>}
                    </td>
                    <td><span className={job.status === "COMPLETED" ? "badge official" : job.status === "FAILED" ? "badge conflict" : "badge"}>{humanStatus(job.status)}</span>{job.error_message && <div style={{ color: "#ff9e9e", fontSize: 9, marginTop: 4 }}>{job.error_message.slice(0, 90)}</div>}</td>
                    <td>{authorized && ["QUEUED", "CLAIMED", "RUNNING"].includes(job.status) ? <button style={smallButton} disabled={busy} onClick={() => void mutateJob(job.id, "cancel")}>Cancelar</button> : authorized && ["FAILED", "CANCELLED", "STALE"].includes(job.status) ? <button style={smallButton} disabled={busy} onClick={() => void mutateJob(job.id, "retry")}>Reintentar</button> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
