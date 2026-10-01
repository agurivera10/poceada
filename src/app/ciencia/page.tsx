import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type CoreStatus = {
  experiments: number;
  frozen_experiments: number;
  frozen_dataset_snapshots: number;
  frozen_feature_snapshots: number;
  frozen_runs: number;
  invalid_frozen_runs: number;
  frozen_portfolios: number;
};

type DatasetSnapshot = {
  id: string;
  label: string;
  through_draw_number: number;
  draw_count: number;
  dataset_sha256: string | null;
  frozen_at: string | null;
};

type ModelVersion = {
  id: string;
  slug: string;
  name: string;
  model_family: string;
  frozen_at: string | null;
};

export default async function SciencePage() {
  const supabase = createPublicClient();

  const [statusRes, datasetsRes, modelsRes, experimentsRes, runsRes] = await Promise.all([
    supabase.from("science_core_status").select("*").maybeSingle(),
    supabase.from("dataset_snapshots").select("id,label,through_draw_number,draw_count,dataset_sha256,frozen_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("model_versions").select("id,slug,name,model_family,frozen_at").order("created_at", { ascending: true }),
    supabase.from("experiments").select("id,slug,name,status,planned_start_draw,planned_min_draws,frozen_at").order("created_at", { ascending: false }).limit(10),
    supabase.from("science_run_integrity").select("run_id,run_kind,target_draw_number,trained_through_draw_number,prediction_count,probability_sum,leakage_cutoff_ok,hashes_complete,science_core_valid").order("target_draw_number", { ascending: false }).limit(20),
  ]);

  const errors = [statusRes.error, datasetsRes.error, modelsRes.error, experimentsRes.error, runsRes.error].filter(Boolean);
  if (errors.length) throw new Error(errors.map((e) => e?.message).join(" | "));

  const status = (statusRes.data ?? {
    experiments: 0,
    frozen_experiments: 0,
    frozen_dataset_snapshots: 0,
    frozen_feature_snapshots: 0,
    frozen_runs: 0,
    invalid_frozen_runs: 0,
    frozen_portfolios: 0,
  }) as CoreStatus;
  const datasets = (datasetsRes.data ?? []) as DatasetSnapshot[];
  const models = (modelsRes.data ?? []) as ModelVersion[];
  const experiments = experimentsRes.data ?? [];
  const runs = runsRes.data ?? [];
  const canonical = datasets[0];

  return (
    <main>
      <div className="shell">
        <section className="hero">
          <div>
            <div className="eyebrow">SCIENCE CORE V1</div>
            <h1>Evidencia antes que relato.</h1>
            <p>
              Esta capa obliga a separar exploración histórica de evidencia prospectiva. Dataset, features, modelo, probabilidades y cartera quedan congelados antes del sorteo objetivo y conservan hashes y semillas reproducibles.
            </p>
          </div>
          <div className="hero-note">
            <strong>Regla anti‑leakage</strong>
            <span>Un run no puede congelarse si su corte de entrenamiento alcanza o supera el sorteo que intenta evaluar.</span>
          </div>
        </section>

        <section className="grid-kpi" aria-label="Estado del protocolo científico">
          <div className="card kpi"><div className="kpi-label">Datasets congelados</div><div className="kpi-value">{status.frozen_dataset_snapshots}</div><div className="kpi-sub">copias inmutables</div></div>
          <div className="card kpi"><div className="kpi-label">Experimentos</div><div className="kpi-value">{status.experiments}</div><div className="kpi-sub">{status.frozen_experiments} preregistrados</div></div>
          <div className="card kpi"><div className="kpi-label">Feature snapshots</div><div className="kpi-value">{status.frozen_feature_snapshots}</div><div className="kpi-sub">100 números por corte</div></div>
          <div className="card kpi"><div className="kpi-label">Runs congelados</div><div className="kpi-value">{status.frozen_runs}</div><div className="kpi-sub">prospectivos</div></div>
          <div className="card kpi"><div className="kpi-label">Runs inválidos</div><div className="kpi-value">{status.invalid_frozen_runs}</div><div className="kpi-sub">debe permanecer en 0</div></div>
        </section>

        <section className="section two-col">
          <div className="card panel">
            <div className="eyebrow">Dataset canónico congelado</div>
            <h2 style={{ marginTop: 7 }}>{canonical?.label ?? "Sin snapshot"}</h2>
            <div className="meta-row" style={{ marginTop: 12 }}>
              <span>Sorteos <strong>{canonical?.draw_count ?? 0}</strong></span>
              <span>Corte <strong>{canonical?.through_draw_number ?? "—"}</strong></span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.6, wordBreak: "break-all" }}>
              SHA‑256: {canonical?.dataset_sha256 ?? "—"}
            </p>
          </div>

          <div className="card panel">
            <div className="eyebrow">Gates del protocolo</div>
            <div className="status-list">
              {[
                ["DATA snapshot inmutable", status.frozen_dataset_snapshots > 0],
                ["Controles base congelados", models.some((m) => m.model_family === "CONTROL" && m.frozen_at)],
                ["Experimento preregistrado", status.frozen_experiments > 0],
                ["Features prospectivas", status.frozen_feature_snapshots > 0],
                ["Run prospectivo válido", status.frozen_runs > 0 && status.invalid_frozen_runs === 0],
              ].map(([label, ok]) => (
                <div className="status-row" key={String(label)}>
                  <span className="status-name">{String(label)}</span>
                  <span className={ok ? "badge official" : "badge"}>{ok ? "OK" : "Pendiente"}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <div><div className="eyebrow">Referencias nulas</div><h2>Modelos base congelados</h2></div>
            <div className="section-desc">Los controles existen para responder si una estrategia aporta información por encima de un mundo sin señal.</div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Modelo</th><th>Familia</th><th>Estado</th></tr></thead>
              <tbody>
                {models.map((model) => (
                  <tr key={model.id}>
                    <td><strong>{model.name}</strong><div style={{ color: "var(--muted)", fontSize: 11 }}>{model.slug}</div></td>
                    <td>{model.model_family}</td>
                    <td><span className={model.frozen_at ? "badge official" : "badge"}>{model.frozen_at ? "Congelado" : "Borrador"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section two-col">
          <div className="card panel">
            <div className="eyebrow">Experimentos</div>
            <h2 style={{ marginTop: 7 }}>{experiments.length ? `${experiments.length} registrados` : "Todavía ninguno"}</h2>
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>
              El próximo paso es preregistrar PROSPECTIVO‑V1 con hipótesis, métrica primaria, controles y tamaño mínimo antes de generar el primer run.
            </p>
          </div>
          <div className="card panel">
            <div className="eyebrow">Runs</div>
            <h2 style={{ marginTop: 7 }}>{runs.length ? `${runs.length} auditables` : "Sin runs prospectivos"}</h2>
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>
              SCIENCE_CORE_V1 exige 100 probabilidades cuya suma sea 10, cutoff anterior al target y hashes completos antes del freeze.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
