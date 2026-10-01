import Link from "next/link";
import { createPublicClient, formatDateAR, formatDrawNumber } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type DrawRow = {
  id: number | null;
  draw_number: number | null;
  draw_date: string | null;
  validation_status: string | null;
  numbers: number[] | null;
  number_count: number | null;
};

const statusLabels: Record<string, string> = {
  OFICIAL: "Oficial",
  SECUNDARIO_VERIFICADO: "Secundario verificado",
  SECUNDARIO_NO_VERIFICADO: "Secundario no verificado",
  RECONSTRUIDO: "Reconstruido",
  CONFLICTO: "Conflicto",
};

function badgeClass(status: string | null) {
  if (status === "OFICIAL") return "badge official";
  if (status === "CONFLICTO") return "badge conflict";
  return "badge";
}

export default async function Home() {
  const supabase = createPublicClient();

  const [drawsCountRes, numbersCountRes, evidenceCountRes, latestRes, recentRes, statusRes, conflictsRes] = await Promise.all([
    supabase.from("draws").select("id", { count: "exact", head: true }),
    supabase.from("draw_numbers").select("draw_id", { count: "exact", head: true }),
    supabase.from("draw_source_evidence").select("id", { count: "exact", head: true }),
    supabase.from("draws_full").select("id,draw_number,draw_date,validation_status,numbers,number_count").order("draw_number", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("draws_full").select("id,draw_number,draw_date,validation_status,numbers,number_count").order("draw_number", { ascending: false }).limit(10),
    supabase.from("draws").select("validation_status"),
    supabase.from("data_conflicts").select("id,draw_number,field_name,observed_values,status,resolution_notes").eq("status", "OPEN").order("draw_number"),
  ]);

  const errors = [drawsCountRes.error, numbersCountRes.error, evidenceCountRes.error, latestRes.error, recentRes.error, statusRes.error, conflictsRes.error].filter(Boolean);
  if (errors.length) {
    throw new Error(errors.map((e) => e?.message).join(" | "));
  }

  const latest = latestRes.data as DrawRow | null;
  const recent = (recentRes.data ?? []) as DrawRow[];
  const statusCounts = (statusRes.data ?? []).reduce<Record<string, number>>((acc, row) => {
    const key = row.validation_status;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const total = drawsCountRes.count ?? 0;
  const maxStatus = Math.max(...Object.values(statusCounts), 1);
  const conflicts = conflictsRes.data ?? [];

  return (
    <main>
      <div className="shell">
        <section className="hero">
          <div>
            <div className="eyebrow">DATA‑V1 · fuente única</div>
            <h1>Poceada, sin autoengaños.</h1>
            <p>
              Base canónica 2025–2026, procedencia por sorteo, conflictos visibles y una arquitectura preparada para evaluar modelos y carteras de forma prospectiva. El objetivo no es fabricar una certeza donde no existe: es medir qué funciona y qué no.
            </p>
          </div>
          <div className="hero-note">
            <strong>Regla del laboratorio</strong>
            <span>Los modelos se congelan antes del sorteo, se comparan contra controles aleatorios con la misma geometría y nunca se reescribe el pasado después de conocer el resultado.</span>
          </div>
        </section>

        <section className="grid-kpi" aria-label="Indicadores principales">
          <div className="card kpi"><div className="kpi-label">Sorteos</div><div className="kpi-value">{total}</div><div className="kpi-sub">N.º 50 a {latest?.draw_number ?? "—"}</div></div>
          <div className="card kpi"><div className="kpi-label">Extracciones</div><div className="kpi-value">{numbersCountRes.count ?? 0}</div><div className="kpi-sub">10 números por sorteo</div></div>
          <div className="card kpi"><div className="kpi-label">Evidencias</div><div className="kpi-value">{evidenceCountRes.count ?? 0}</div><div className="kpi-sub">trazabilidad de fuentes</div></div>
          <div className="card kpi"><div className="kpi-label">Conflictos abiertos</div><div className="kpi-value">{conflicts.length}</div><div className="kpi-sub">no se ocultan ni pisan</div></div>
          <div className="card kpi"><div className="kpi-label">Sorteos oficiales</div><div className="kpi-value">{statusCounts.OFICIAL ?? 0}</div><div className="kpi-sub">confirmados en la fuente cargada</div></div>
        </section>

        {conflicts.length > 0 && (
          <section className="alert">
            <span className="alert-dot" />
            <div>
              <strong>Hay {conflicts.length} conflicto{conflicts.length === 1 ? "" : "s"} de datos abierto{conflicts.length === 1 ? "" : "s"}</strong>
              <p>
                El sorteo 101 tiene dos fechas en los artefactos históricos: 30/04/2025 y 01/05/2025. DATA‑V1 conserva 30/04/2025 como fecha provisional y mantiene el conflicto abierto hasta verificarlo con una fuente oficial.
              </p>
            </div>
          </section>
        )}

        <section className="section two-col">
          <div className="card panel">
            <div className="eyebrow">Último registro cargado</div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline", marginTop: 7 }}>
              <h2>Sorteo {latest?.draw_number ?? "—"}</h2>
              <span className={badgeClass(latest?.validation_status ?? null)}>{statusLabels[latest?.validation_status ?? ""] ?? latest?.validation_status ?? "—"}</span>
            </div>
            <div className="meta-row" style={{ marginTop: 8 }}>
              <span>Fecha <strong>{formatDateAR(latest?.draw_date ?? null)}</strong></span>
              <span>Integridad <strong>{latest?.number_count ?? 0}/10</strong></span>
            </div>
            <div className="balls">
              {(latest?.numbers ?? []).map((n) => <span className="ball" key={n}>{formatDrawNumber(n)}</span>)}
            </div>
          </div>

          <div className="card panel">
            <div className="eyebrow">Estado de validación</div>
            <div className="status-list">
              {Object.entries(statusCounts).sort((a,b) => b[1]-a[1]).map(([status, count]) => (
                <div className="status-row" key={status}>
                  <span className="status-name">{statusLabels[status] ?? status}</span>
                  <span className="bar"><span style={{ width: `${(count / maxStatus) * 100}%` }} /></span>
                  <span className="status-count">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <div><div className="eyebrow">Histórico</div><h2>Últimos sorteos</h2></div>
            <div className="section-desc">La tabla se lee directamente desde Supabase. Ya no existe una copia separada de los datos dentro de cada dashboard.</div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Sorteo</th><th>Fecha</th><th>Números</th><th>Estado</th></tr></thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id ?? row.draw_number}>
                    <td><strong>{row.draw_number}</strong></td>
                    <td>{formatDateAR(row.draw_date)}</td>
                    <td><div className="num-inline">{(row.numbers ?? []).map((n) => <span className="num-chip" key={n}>{formatDrawNumber(n)}</span>)}</div></td>
                    <td><span className={badgeClass(row.validation_status)}>{statusLabels[row.validation_status ?? ""] ?? row.validation_status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section two-col">
          <Link href="/datos" className="card panel">
            <div className="eyebrow">DATA‑V1</div><h2 style={{ marginTop: 7 }}>Explorar la base →</h2>
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>Sorteos, números, fechas, estados de validación y continuidad 50–316.</p>
          </Link>
          <Link href="/auditoria" className="card panel">
            <div className="eyebrow">Trazabilidad</div><h2 style={{ marginTop: 7 }}>Abrir auditoría →</h2>
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>Fuentes cargadas, evidencia por artefacto y conflictos que todavía requieren verificación.</p>
          </Link>
        </section>
      </div>
    </main>
  );
}
