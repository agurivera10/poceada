import { createPublicClient, formatDateAR } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Source = { id: string; code: string; name: string; kind: string; authority_level: number; notes: string | null };
type Conflict = { id: string; draw_number: number; field_name: string; observed_values: unknown; status: string; resolution_notes: string | null; created_at: string };

export default async function AuditoriaPage() {
  const supabase = createPublicClient();
  const [sourcesRes, evidenceRes, conflictsRes] = await Promise.all([
    supabase.from("data_sources").select("id,code,name,kind,authority_level,notes").order("authority_level", { ascending: false }),
    supabase.from("draw_source_evidence").select("id,source_id,evidence_status", { count: "exact" }),
    supabase.from("data_conflicts").select("id,draw_number,field_name,observed_values,status,resolution_notes,created_at").order("draw_number"),
  ]);
  const errors = [sourcesRes.error, evidenceRes.error, conflictsRes.error].filter(Boolean);
  if (errors.length) throw new Error(errors.map(e => e?.message).join(" | "));

  const sources = (sourcesRes.data ?? []) as Source[];
  const conflicts = (conflictsRes.data ?? []) as Conflict[];
  const evidence = evidenceRes.data ?? [];
  const evidenceBySource = evidence.reduce<Record<string, number>>((acc, row) => {
    acc[row.source_id] = (acc[row.source_id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <main>
      <div className="shell">
        <section className="page-title">
          <div className="eyebrow">TRAZABILIDAD</div>
          <h1>Auditoría de datos</h1>
          <p>
            Cada artefacto importado queda registrado como evidencia separada de la base canónica. Una discrepancia no se corrige silenciosamente: se convierte en conflicto y permanece abierta hasta que una fuente con autoridad suficiente permita resolverla.
          </p>
        </section>

        <section className="grid-kpi">
          <div className="card kpi"><div className="kpi-label">Fuentes</div><div className="kpi-value">{sources.length}</div><div className="kpi-sub">artefactos registrados</div></div>
          <div className="card kpi"><div className="kpi-label">Evidencias</div><div className="kpi-value">{evidenceRes.count ?? evidence.length}</div><div className="kpi-sub">filas con procedencia</div></div>
          <div className="card kpi"><div className="kpi-label">Conflictos</div><div className="kpi-value">{conflicts.length}</div><div className="kpi-sub">históricos detectados</div></div>
          <div className="card kpi"><div className="kpi-label">Abiertos</div><div className="kpi-value">{conflicts.filter(c => c.status === "OPEN").length}</div><div className="kpi-sub">requieren verificación</div></div>
          <div className="card kpi"><div className="kpi-label">Sets divergentes</div><div className="kpi-value">0</div><div className="kpi-sub">en la auditoría importada</div></div>
        </section>

        <section className="section">
          <div className="section-head">
            <div><div className="eyebrow">Inventario</div><h2>Fuentes registradas</h2></div>
            <div className="section-desc">El nivel de autoridad describe cuánto pesa una fuente en la construcción de DATA‑V1; no convierte una fuente secundaria en oficial.</div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fuente</th><th>Tipo</th><th>Autoridad</th><th>Evidencias</th><th>Notas</th></tr></thead>
              <tbody>
                {sources.map(source => (
                  <tr key={source.id}>
                    <td><strong>{source.name}</strong><div className="code" style={{color:"var(--muted)",marginTop:4}}>{source.code}</div></td>
                    <td><span className="badge">{source.kind}</span></td>
                    <td>{source.authority_level}/100</td>
                    <td>{evidenceBySource[source.id] ?? 0}</td>
                    <td style={{color:"var(--muted)",maxWidth:420}}>{source.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <div><div className="eyebrow">No reconciliar en silencio</div><h2>Conflictos</h2></div>
            <div className="section-desc">Un conflicto resuelto conservará igualmente sus valores originales y una nota de resolución.</div>
          </div>
          {conflicts.length === 0 ? <div className="card empty">No hay conflictos registrados.</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Sorteo</th><th>Campo</th><th>Valores observados</th><th>Estado</th><th>Resolución</th></tr></thead>
                <tbody>
                  {conflicts.map(conflict => (
                    <tr key={conflict.id}>
                      <td><strong>{conflict.draw_number}</strong></td>
                      <td>{conflict.field_name}</td>
                      <td><span className="code">{JSON.stringify(conflict.observed_values)}</span></td>
                      <td><span className={conflict.status === "OPEN" ? "badge conflict" : "badge"}>{conflict.status}</span></td>
                      <td style={{color:"var(--muted)",maxWidth:380}}>{conflict.resolution_notes ?? `Registrado ${formatDateAR(conflict.created_at.slice(0,10))}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
