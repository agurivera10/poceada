import { createPublicClient, formatDateAR, formatDrawNumber } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Draw = {
  id: number | null;
  draw_number: number | null;
  draw_date: string | null;
  validation_status: string | null;
  numbers: number[] | null;
  number_count: number | null;
};

export default async function DatosPage() {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("draws_full")
    .select("id,draw_number,draw_date,validation_status,numbers,number_count")
    .order("draw_number", { ascending: false });

  if (error) throw new Error(error.message);
  const draws = (data ?? []) as Draw[];

  return (
    <main>
      <div className="shell">
        <section className="page-title">
          <div className="eyebrow">DATA‑V1</div>
          <h1>Base canónica</h1>
          <p>
            Un registro por sorteo y diez números únicos por registro. El estado de validación no es decorativo: distingue datos oficiales, cruces independientes, reconstrucciones, fuentes secundarias todavía no verificadas y conflictos abiertos.
          </p>
        </section>

        <section className="grid-kpi">
          <div className="card kpi"><div className="kpi-label">Sorteos</div><div className="kpi-value">{draws.length}</div><div className="kpi-sub">50–316</div></div>
          <div className="card kpi"><div className="kpi-label">2025</div><div className="kpi-value">{draws.filter(d => d.draw_date?.startsWith("2025")).length}</div><div className="kpi-sub">base completa</div></div>
          <div className="card kpi"><div className="kpi-label">2026</div><div className="kpi-value">{draws.filter(d => d.draw_date?.startsWith("2026")).length}</div><div className="kpi-sub">hasta sorteo 316</div></div>
          <div className="card kpi"><div className="kpi-label">Integridad</div><div className="kpi-value">{draws.filter(d => d.number_count === 10).length}</div><div className="kpi-sub">sorteos con 10/10</div></div>
          <div className="card kpi"><div className="kpi-label">Huecos</div><div className="kpi-value">{draws.filter(d => d.number_count !== 10).length}</div><div className="kpi-sub">registros incompletos</div></div>
        </section>

        <section className="section">
          <div className="section-head">
            <div><div className="eyebrow">267 registros</div><h2>Sorteos 50–316</h2></div>
            <div className="section-desc">Orden descendente. Los números se muestran normalizados a dos dígitos; la procedencia detallada vive en Auditoría.</div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Sorteo</th><th>Fecha</th><th>Números</th><th>Integridad</th><th>Validación</th></tr></thead>
              <tbody>
                {draws.map((draw) => (
                  <tr key={draw.id ?? draw.draw_number}>
                    <td><strong>{draw.draw_number}</strong></td>
                    <td>{formatDateAR(draw.draw_date)}</td>
                    <td><div className="num-inline">{(draw.numbers ?? []).map(n => <span className="num-chip" key={n}>{formatDrawNumber(n)}</span>)}</div></td>
                    <td>{draw.number_count}/10</td>
                    <td><span className={draw.validation_status === "CONFLICTO" ? "badge conflict" : draw.validation_status === "OFICIAL" ? "badge official" : "badge"}>{draw.validation_status}</span></td>
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
