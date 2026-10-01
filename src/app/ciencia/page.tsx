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

type ExperimentRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  primary_metric: string;
  planned_start_draw: number;
  planned_min_draws: number;
  frozen_at: string | null;
};

type FeatureRow = {
  id: string;
  target_draw_number: number;
  trained_through_draw_number: number;
  feature_version: string;
  snapshot_sha256: string | null;
  git_commit_sha: string;
  frozen_at: string | null;
};

type RunRow = {
  run_id: string;
  protocol_version: string;
  run_kind: string;
  target_draw_number: number;
  trained_through_draw_number: number;
  prediction_count: number;
  probability_count: number;
  probability_sum: number | null;
  leakage_cutoff_ok: boolean;
  hashes_complete: boolean;
  protocol_valid: boolean;
};

type PortfolioRow = {
  id: string;
  name: string;
  strategy: string;
  ticket_price_ars: number | string;
  budget_ars: number | string;
  portfolio_sha256: string | null;
  frozen_at: string | null;
};

type GeometryRow = {
  portfolio_id: string;
  unique_numbers: number;
  unique_four_subsets: number;
  duplicate_four_subsets: number;
  max_pairwise_overlap: number;
  min_number_usage: number;
  max_number_usage: number;
  p_at_least_3: number;
  p_at_least_4: number;
  p_at_least_5: number;
  p_multiple_4plus: number;
};

type ShadowRow = {
  id: string;
  target_draw_number: number;
  shadow_count: number;
  pool_size: number;
  ticket_count: number;
  generator_version: string;
  geometry_template: string;
  batch_sha256: string | null;
  frozen_at: string | null;
};

const pct = (value: number) => `${(value * 100).toFixed(5)}%`;

export default async function SciencePage() {
  const supabase = createPublicClient();

  const [statusRes, datasetsRes, modelsRes, experimentsRes, featuresRes, runsRes, portfoliosRes, geometryRes, shadowsRes] = await Promise.all([
    supabase.from("science_core_status").select("*").maybeSingle(),
    supabase.from("dataset_snapshots").select("id,label,through_draw_number,draw_count,dataset_sha256,frozen_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("model_versions").select("id,slug,name,model_family,frozen_at").order("created_at", { ascending: true }),
    supabase.from("experiments").select("id,slug,name,status,primary_metric,planned_start_draw,planned_min_draws,frozen_at").order("created_at", { ascending: false }).limit(10),
    supabase.from("feature_snapshots").select("id,target_draw_number,trained_through_draw_number,feature_version,snapshot_sha256,git_commit_sha,frozen_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("science_run_integrity").select("run_id,protocol_version,run_kind,target_draw_number,trained_through_draw_number,prediction_count,probability_count,probability_sum,leakage_cutoff_ok,hashes_complete,protocol_valid").order("target_draw_number", { ascending: false }).limit(30),
    supabase.from("portfolios").select("id,name,strategy,ticket_price_ars,budget_ars,portfolio_sha256,frozen_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("portfolio_geometry_metrics").select("portfolio_id,unique_numbers,unique_four_subsets,duplicate_four_subsets,max_pairwise_overlap,min_number_usage,max_number_usage,p_at_least_3,p_at_least_4,p_at_least_5,p_multiple_4plus"),
    supabase.from("shadow_batches").select("id,target_draw_number,shadow_count,pool_size,ticket_count,generator_version,geometry_template,batch_sha256,frozen_at").order("created_at", { ascending: false }).limit(10),
  ]);

  const errors = [statusRes.error, datasetsRes.error, modelsRes.error, experimentsRes.error, featuresRes.error, runsRes.error, portfoliosRes.error, geometryRes.error, shadowsRes.error].filter(Boolean);
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
  const experiments = (experimentsRes.data ?? []) as ExperimentRow[];
  const features = (featuresRes.data ?? []) as FeatureRow[];
  const runs = (runsRes.data ?? []) as RunRow[];
  const portfolios = (portfoliosRes.data ?? []) as PortfolioRow[];
  const geometry = (geometryRes.data ?? []) as GeometryRow[];
  const shadows = (shadowsRes.data ?? []) as ShadowRow[];
  const geometryByPortfolio = new Map(geometry.map((g) => [g.portfolio_id, g]));
  const canonical = datasets[0];
  const lockedFeature = features.find((f) => f.feature_version === "FEATURES_V1_LOCKED") ?? features[0];
  const shadow = shadows[0];

  return (
    <main>
      <div className="shell">
        <section className="hero">
          <div>
            <div className="eyebrow">SCIENCE CORE · PROSPECTIVO‑V1</div>
            <h1>El experimento ya está corriendo.</h1>
            <p>
              El sorteo 317 es el primer target prospectivo: todo usa información congelada únicamente hasta el 316. Selección, probabilidades, geometría de tickets y controles aleatorios quedan separados para saber qué componente aporta —o no aporta— evidencia.
            </p>
          </div>
          <div className="hero-note">
            <strong>Regla anti‑relato</strong>
            <span>Después del freeze no se cambian rankings, probabilidades, tickets, seeds ni métricas para acomodarlos al resultado.</span>
          </div>
        </section>

        <section className="grid-kpi" aria-label="Estado del protocolo científico">
          <div className="card kpi"><div className="kpi-label">Experimentos</div><div className="kpi-value">{status.experiments}</div><div className="kpi-sub">{status.frozen_experiments} preregistrados</div></div>
          <div className="card kpi"><div className="kpi-label">Runs congelados</div><div className="kpi-value">{status.frozen_runs}</div><div className="kpi-sub">target 317</div></div>
          <div className="card kpi"><div className="kpi-label">Carteras</div><div className="kpi-value">{status.frozen_portfolios}</div><div className="kpi-sub">geometría exacta</div></div>
          <div className="card kpi"><div className="kpi-label">Shadows</div><div className="kpi-value">{shadow?.shadow_count ?? 0}</div><div className="kpi-sub">Random‑15 reproducibles</div></div>
          <div className="card kpi"><div className="kpi-label">Runs inválidos</div><div className="kpi-value">{status.invalid_frozen_runs}</div><div className="kpi-sub">debe permanecer en 0</div></div>
        </section>

        <section className="section two-col">
          <div className="card panel">
            <div className="eyebrow">Dataset congelado</div>
            <h2 style={{ marginTop: 7 }}>{canonical?.label ?? "Sin snapshot"}</h2>
            <div className="meta-row" style={{ marginTop: 12 }}>
              <span>Sorteos <strong>{canonical?.draw_count ?? 0}</strong></span>
              <span>Corte <strong>{canonical?.through_draw_number ?? "—"}</strong></span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.6, wordBreak: "break-all" }}>SHA‑256: {canonical?.dataset_sha256 ?? "—"}</p>
          </div>

          <div className="card panel">
            <div className="eyebrow">Features del 317</div>
            <h2 style={{ marginTop: 7 }}>{lockedFeature?.feature_version ?? "—"}</h2>
            <div className="meta-row" style={{ marginTop: 12 }}>
              <span>Entrenado hasta <strong>{lockedFeature?.trained_through_draw_number ?? "—"}</strong></span>
              <span>Target <strong>{lockedFeature?.target_draw_number ?? "—"}</strong></span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.6, wordBreak: "break-all" }}>SHA‑256: {lockedFeature?.snapshot_sha256 ?? "—"}</p>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <div><div className="eyebrow">Preregistro</div><h2>Experimentos activos</h2></div>
            <div className="section-desc">La métrica primaria se fijó antes del resultado. Las métricas secundarias no reemplazan a la primaria si el resultado no conviene.</div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Experimento</th><th>Estado</th><th>Métrica primaria</th><th>Inicio</th><th>Mínimo</th></tr></thead>
              <tbody>
                {experiments.map((e) => (
                  <tr key={e.id}>
                    <td><strong>{e.name}</strong><div style={{ color: "var(--muted)", fontSize: 11 }}>{e.slug}</div></td>
                    <td><span className="badge official">{e.status}</span></td>
                    <td>{e.primary_metric}</td>
                    <td>{e.planned_start_draw}</td>
                    <td>{e.planned_min_draws} sorteos</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <div><div className="eyebrow">Cobertura</div><h2>Carteras congeladas</h2></div>
            <div className="section-desc">Bajo azar uniforme, las cuatro carteras K6 tienen la misma probabilidad matemática; sólo cambia la selección de sus 15 números. La rueda concentra la dependencia.</div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Cartera</th><th>Geometría</th><th>Números</th><th>4-subsets únicos</th><th>Overlap máx.</th><th>P(≥4)</th><th>Presupuesto</th></tr></thead>
              <tbody>
                {portfolios.map((p) => {
                  const g = geometryByPortfolio.get(p.id);
                  return (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong></td>
                      <td>{p.strategy}</td>
                      <td>{g?.unique_numbers ?? "—"}</td>
                      <td>{g?.unique_four_subsets ?? "—"}</td>
                      <td>{g?.max_pairwise_overlap ?? "—"}</td>
                      <td>{g ? <>{pct(g.p_at_least_4)}<div style={{ color: "var(--muted)", fontSize: 11 }}>≈ 1 en {(1 / g.p_at_least_4).toFixed(1)}</div></> : "—"}</td>
                      <td>${Number(p.budget_ars).toLocaleString("es-AR")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section two-col">
          <div className="card panel">
            <div className="eyebrow">Shadow controls</div>
            <h2 style={{ marginTop: 7 }}>{shadow ? `${shadow.shadow_count} Random‑15` : "Sin batch"}</h2>
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>
              {shadow ? `Pool ${shadow.pool_size}, ${shadow.ticket_count} tickets, geometría ${shadow.geometry_template}, generador ${shadow.generator_version}.` : "—"}
            </p>
            <p style={{ color: "var(--muted)", fontSize: 11, wordBreak: "break-all" }}>Batch SHA‑256: {shadow?.batch_sha256 ?? "—"}</p>
          </div>

          <div className="card panel">
            <div className="eyebrow">Integridad</div>
            <div className="status-list">
              {[
                ["Dataset inmutable", status.frozen_dataset_snapshots > 0],
                ["Features previas al target", Boolean(lockedFeature?.frozen_at && lockedFeature.trained_through_draw_number < lockedFeature.target_draw_number)],
                ["Experimentos preregistrados", status.frozen_experiments === status.experiments && status.experiments > 0],
                ["Runs con cutoff + hashes", runs.length > 0 && runs.every((r) => r.leakage_cutoff_ok && r.hashes_complete)],
                ["Protocolos válidos", status.invalid_frozen_runs === 0],
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
            <div><div className="eyebrow">Modelos</div><h2>Versiones congeladas</h2></div>
            <div className="section-desc">Un modelo nuevo no puede agregarse a un experimento ya congelado y hacerse pasar por una predicción previa.</div>
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
      </div>
    </main>
  );
}
