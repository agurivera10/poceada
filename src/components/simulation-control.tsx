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
  padding: "10px 12px",
  borderRadius: 9,
  border: "1px solid var(--line)",
  background: "#0b121b",
  color: "var(--text)",
  font: "inherit",
};

const smallButton: CSSProperties = {
  border: "1px solid var(--line)",
  background: "#0d1621",
  color: "var(--text)",
  borderRadius: 8,
  padding: "7px 10px",
  cursor: "pointer",
  fontSize: 11,
};

function compact(value: number | string | null | undefined) {
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function percent(job: Job) {
  const total = Number(job.requested_iterations || 0);
  const done = Number(job.progress_iterations || 0);
  return total > 0 ? Math.min(100, (done / total) * 100) : 0;
}

function throughput(job: Job) {
  if (!job.started_at) return null;
  const seconds = Math.max(1, (Date.now() - new Date(job.started_at).getTime()) / 1000);
  const rate = Number(job.progress_iterations || 0) / seconds;
  return rate > 0 ? `${compact(rate)}/s` : null;
}

export function SimulationControl({
  presets,
  initialJobs,
  initialWorkers,
  initialAuthorized,
}: {
  presets: Preset[];
  initialJobs: Job[];
  initialWorkers: Worker[];
  initialAuthorized: boolean;
}) {
  const supabase = useMemo(() => createPublicClient(), []);
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [workers, setWorkers] = useState<Worker[]>(initialWorkers);
  const [authorized, setAuthorized] = useState(initialAuthorized);
  const [password, setPassword] = useState("");
  const [presetSlug, setPresetSlug] = useState(presets[0]?.slug ?? "");
  const selectedPreset = presets.find((p) => p.slug === presetSlug);
  const [name, setName] = useState("");
  const [iterations, setIterations] = useState(String(presets[0]?.default_iterations ?? 1_000_000));
  const [seed, setSeed] = useState(String(Date.now()));
  const [priority, setPriority] = useState("50");
  const [configText, setConfigText] = useState(JSON.stringify(presets[0]?.default_config ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
          const next = found ? current.map((item) => (item.id === row.id ? row : item)) : [row, ...current];
          return next.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 40);
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
        setWorkers((current) => {
          const found = current.some((item) => item.id === row.id);
          return found ? current.map((item) => (item.id === row.id ? row : item)) : [row, ...current];
        });
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
      const response = await fetch("/api/lab/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No autorizado");
      setAuthorized(true);
      setPassword("");
      setMessage("Control administrativo habilitado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/lab/logout", { method: "POST" });
    setAuthorized(false);
    setMessage("Sesión administrativa cerrada.");
  }

  async function launch() {
    setBusy(true);
    setMessage(null);
    try {
      const config = JSON.parse(configText || "{}");
      const response = await fetch("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          preset: presetSlug,
          iterations: Number(iterations),
          seed: Number(seed),
          priority: Number(priority),
          config,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo crear el job");
      setMessage(`Job ${body.job?.id?.slice(0, 8) ?? ""} en cola.`);
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
      setMessage(action === "cancel" ? "Cancelación solicitada." : "Retry en cola.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operación fallida.");
    } finally {
      setBusy(false);
    }
  }

  const onlineWorkers = workers.filter((worker) => Date.now() - new Date(worker.last_seen_at).getTime() < 5 * 60_000);

  return (
    <section className="section">
      <div className="section-head">
        <div><div className="eyebrow">COMPUTE CONTROL ROOM</div><h2>Ejecutar desde POCEADA LAB</h2></div>
        <div className="section-desc">La app crea el job en Supabase. Un worker Python lo reclama, reporta progreso y persiste los resultados sin pasar por GitHub Actions.</div>
      </div>

      <div className="two-col">
        <div className="card panel">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 16 }}>
            <div><div className="eyebrow">ADMIN</div><h2 style={{ marginTop: 5 }}>{authorized ? "Control habilitado" : "Desbloquear ejecución"}</h2></div>
            <span className={authorized ? "badge official" : "badge"}>{authorized ? "AUTHORIZED" : "READ ONLY"}</span>
          </div>
          {!authorized ? (
            <div style={{ display: "flex", gap: 8 }}>
              <input style={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña del laboratorio" onKeyDown={(e) => { if (e.key === "Enter") void login(); }} />
              <button style={smallButton} disabled={busy} onClick={() => void login()}>Entrar</button>
            </div>
          ) : (
            <button style={smallButton} onClick={() => void logout()}>Cerrar sesión admin</button>
          )}
          {message && <div style={{ marginTop: 12, fontSize: 12, color: "var(--accent)" }}>{message}</div>}
        </div>

        <div className="card panel">
          <div className="eyebrow">PYTHON WORKERS</div>
          <h2 style={{ marginTop: 5 }}>{onlineWorkers.length} conectados</h2>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {onlineWorkers.length === 0 ? <span style={{ color: "var(--muted)", fontSize: 12 }}>No hay worker activo. Los jobs pueden quedar en cola hasta que uno se conecte.</span> : onlineWorkers.map((worker) => (
              <div key={worker.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
                <div><strong>{worker.display_name}</strong><div style={{ color: "var(--muted)", fontSize: 10 }}>{worker.engine_version} · {worker.cpu_count ?? "?"} CPU</div></div>
                <span className={worker.status === "BUSY" ? "badge" : "badge official"}>{worker.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card panel" style={{ marginTop: 16, opacity: authorized ? 1 : 0.7 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 18 }}>
          <div><div className="eyebrow">NEW JOB</div><h2 style={{ marginTop: 5 }}>{selectedPreset?.name ?? "Simulación"}</h2></div>
          <span className="badge">{selectedPreset?.engine_version ?? "—"}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>Preset<select style={{ ...field, marginTop: 6 }} value={presetSlug} onChange={(e) => choosePreset(e.target.value)}>{presets.map((preset) => <option key={preset.slug} value={preset.slug}>{preset.name}</option>)}</select></label>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>Nombre<input style={{ ...field, marginTop: 6 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Opcional" /></label>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>Iteraciones<input style={{ ...field, marginTop: 6 }} inputMode="numeric" value={iterations} onChange={(e) => setIterations(e.target.value.replace(/\D/g, ""))} /></label>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>Seed<input style={{ ...field, marginTop: 6 }} inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} /></label>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>Prioridad 0–100<input style={{ ...field, marginTop: 6 }} inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 12 }}>
          {[100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000].map((value) => <button key={value} style={smallButton} onClick={() => setIterations(String(value))}>{compact(value)}</button>)}
        </div>
        <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.6, marginTop: 14 }}>{selectedPreset?.description}</p>
        <details style={{ marginTop: 12 }} open={presetSlug === "portfolio-optimizer-v1"}>
          <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>Configuración avanzada JSON</summary>
          <textarea style={{ ...field, minHeight: 130, marginTop: 8, fontFamily: "monospace", fontSize: 11 }} value={configText} onChange={(e) => setConfigText(e.target.value)} />
        </details>
        <button disabled={!authorized || busy || !presetSlug} onClick={() => void launch()} style={{ ...smallButton, marginTop: 14, padding: "11px 16px", borderColor: authorized ? "var(--accent)" : "var(--line)", color: authorized ? "var(--accent)" : "var(--muted)" }}>▶ Ejecutar en Python</button>
      </div>

      <div className="card panel" style={{ marginTop: 16 }}>
        <div className="section-head"><div><div className="eyebrow">LIVE QUEUE</div><h2>Jobs</h2></div><div className="section-desc">Actualización por Supabase Realtime.</div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Job</th><th>Preset</th><th>Progreso</th><th>Worker</th><th>Estado</th><th>Acción</th></tr></thead>
            <tbody>
              {jobs.length === 0 ? <tr><td colSpan={6} style={{ color: "var(--muted)" }}>Todavía no hay jobs lanzados desde la app.</td></tr> : jobs.map((job) => {
                const pct = percent(job);
                return (
                  <tr key={job.id}>
                    <td><strong>{job.id.slice(0, 8)}</strong><div style={{ fontSize: 10, color: "var(--muted)" }}>seed {job.seed_base} · intento {job.attempt}</div></td>
                    <td>{job.preset_slug}<div style={{ fontSize: 10, color: "var(--muted)" }}>{job.current_phase ?? "—"}</div></td>
                    <td style={{ minWidth: 180 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 5 }}><span>{compact(job.progress_iterations)} / {compact(job.requested_iterations)}</span><span>{pct.toFixed(1)}%</span></div>
                      <div style={{ height: 5, background: "#0b121b", borderRadius: 10, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", transition: "width .3s" }} /></div>
                      {throughput(job) && <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 4 }}>{throughput(job)}</div>}
                    </td>
                    <td>{job.worker_id ? job.worker_id.slice(0, 18) : "—"}</td>
                    <td><span className={job.status === "COMPLETED" ? "badge official" : "badge"}>{job.status}</span>{job.error_message && <div style={{ color: "#ff9e9e", fontSize: 9, marginTop: 4 }}>{job.error_message.slice(0, 90)}</div>}</td>
                    <td>{authorized && ["QUEUED", "CLAIMED", "RUNNING"].includes(job.status) ? <button style={smallButton} disabled={busy} onClick={() => void mutateJob(job.id, "cancel")}>Cancelar</button> : authorized && ["FAILED", "CANCELLED", "STALE"].includes(job.status) ? <button style={smallButton} disabled={busy} onClick={() => void mutateJob(job.id, "retry")}>Retry</button> : "—"}</td>
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
