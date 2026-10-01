import Link from "next/link";

type MetricLike = {
  metric_name: string;
  metric_value: number | null;
};

type FamilyData = Record<string, number>;

const familyLabels: Record<string, string> = {
  disjoint_6: "Disjoint‑6",
  k6_edge_15: "K6 Edge‑15",
  wheel_6: "Wheel‑6",
  optimizer_best: "Optimizer Best",
};

const familyProfiles: Record<string, string> = {
  disjoint_6: "Máxima amplitud: seis tickets sin números repetidos entre sí.",
  k6_edge_15: "Equilibrio: 15 números, baja superposición y 30 coberturas de cuatro distintas.",
  wheel_6: "Concentración: apuesta fuerte a un núcleo de seis números y multiplica cobros si entra.",
  optimizer_best: "Geometría encontrada por el optimizador para la función objetivo elegida.",
};

function labelFamily(value: string) {
  return familyLabels[value] ?? value.replaceAll("_", " ");
}

function percent(value: number | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "percent",
    minimumFractionDigits: value < 0.01 ? 3 : 1,
    maximumFractionDigits: value < 0.01 ? 5 : 2,
  }).format(value);
}

function oneIn(value: number | undefined) {
  if (!value || value <= 0) return "—";
  const n = 1 / value;
  return `1 en ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: n < 100 ? 1 : 0 }).format(n)}`;
}

function eventMatrix(metrics: MetricLike[]) {
  const out = new Map<string, FamilyData>();
  for (const row of metrics) {
    if (row.metric_value == null || !row.metric_name.startsWith("event.")) continue;
    const [, family, ...rest] = row.metric_name.split(".");
    if (!family || rest.length === 0) continue;
    const current = out.get(family) ?? {};
    current[rest.join(".")] = Number(row.metric_value);
    out.set(family, current);
  }
  return [...out.entries()];
}

function bestFor(rows: Array<[string, FamilyData]>, metric: string) {
  const candidates = rows
    .map(([family, values]) => ({ family, value: values[metric] }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value);
  if (!candidates.length) return null;
  const best = candidates[0];
  const second = candidates[1];
  return {
    ...best,
    delta: second ? best.value - second.value : null,
  };
}

function quality(iterations: number) {
  if (iterations >= 100_000_000) return { label: "Muy alta", className: "decision-good", note: "Escala fuerte incluso para eventos raros." };
  if (iterations >= 10_000_000) return { label: "Alta", className: "decision-good", note: "Buena para comparar 2+/3+/4+; 5 sigue siendo muy raro." };
  if (iterations >= 1_000_000) return { label: "Media", className: "decision-warn", note: "Útil para dirección; conviene más escala antes de cerrar 4+/5." };
  return { label: "Exploratoria", className: "decision-warn", note: "Sirve para validar el circuito, no para cerrar decisiones sobre eventos raros." };
}

export function DecisionSummary({
  metrics,
  iterations,
  experimentName,
  experimentId,
}: {
  metrics: MetricLike[];
  iterations: number;
  experimentName?: string | null;
  experimentId?: string | null;
}) {
  const rows = eventMatrix(metrics);
  if (!rows.length) return null;

  const q = quality(iterations);
  const objectives = [
    { key: "at_least_2", kicker: "COBRAR ALGO", title: "Maximizar 2+", explanation: "Prioriza frecuencia de premio, sin importar cuánto paga cada nivel." },
    { key: "at_least_3", kicker: "PREMIO INTERMEDIO", title: "Maximizar 3+", explanation: "Busca una cartera con más escenarios de tres o más aciertos." },
    { key: "at_least_4", kicker: "OBJETIVO FUERTE", title: "Maximizar 4+", explanation: "Optimiza el evento que venimos tratando como objetivo central de cobertura." },
    { key: "multiple_4plus", kicker: "CONCENTRACIÓN", title: "Varios 4+", explanation: "Premia geometrías que pueden producir más de un ticket fuerte en el mismo sorteo." },
  ].map((objective) => ({ ...objective, best: bestFor(rows, objective.key) }));

  const max2 = Math.max(...rows.map(([, v]) => v.at_least_2 ?? 0), 0.000001);
  const max3 = Math.max(...rows.map(([, v]) => v.at_least_3 ?? 0), 0.000001);
  const max4 = Math.max(...rows.map(([, v]) => v.at_least_4 ?? 0), 0.000001);

  return (
    <section className="section decision-board">
      <div className="section-head">
        <div>
          <div className="eyebrow">DECISION BOARD</div>
          <h2>Qué cambia según lo que quieras maximizar</h2>
        </div>
        <div className="section-desc">
          Última corrida: <strong>{experimentName ?? "simulación completada"}</strong> · {new Intl.NumberFormat("es-AR").format(iterations)} universos.
        </div>
      </div>

      <div className="decision-context card">
        <div>
          <span className="decision-context-label">Calidad de evidencia</span>
          <strong className={q.className}>{q.label}</strong>
          <span>{q.note}</span>
        </div>
        <div>
          <span className="decision-context-label">Costo comparable</span>
          <strong>6 tickets · $12.000</strong>
          <span>Las geometrías se comparan con el mismo presupuesto.</span>
        </div>
        <div>
          <span className="decision-context-label">Cómo leerlo</span>
          <strong>Geometría ≠ predicción</strong>
          <span>Esto decide cómo repartir tickets; no demuestra que ciertos números “vayan a salir”.</span>
        </div>
      </div>

      <div className="decision-objectives">
        {objectives.map((objective) => (
          <article className="card decision-card" key={objective.key}>
            <div className="decision-kicker">{objective.kicker}</div>
            <h3>{objective.title}</h3>
            {objective.best ? (
              <>
                <div className="decision-winner">{labelFamily(objective.best.family)}</div>
                <div className="decision-probability">{percent(objective.best.value)}</div>
                <div className="decision-onein">{oneIn(objective.best.value)}</div>
                {objective.best.delta != null && objective.best.delta > 0 ? (
                  <div className="decision-delta">+{percent(objective.best.delta)} vs. segunda observada</div>
                ) : null}
              </>
            ) : <div className="decision-empty">Sin datos</div>}
            <p>{objective.explanation}</p>
          </article>
        ))}
      </div>

      <div className="card decision-comparison">
        <div className="decision-comparison-head">
          <div>
            <div className="eyebrow">COMPARADOR</div>
            <h3>Una geometría no gana en todo</h3>
          </div>
          {experimentId ? <Link className="decision-link" href={`/simulaciones/${experimentId}`}>Ver análisis completo →</Link> : null}
        </div>
        <div className="strategy-list">
          {rows.map(([family, values]) => (
            <div className="strategy-row" key={family}>
              <div className="strategy-copy">
                <strong>{labelFamily(family)}</strong>
                <span>{familyProfiles[family] ?? "Estrategia geométrica comparable."}</span>
              </div>
              <div className="strategy-metrics">
                <div><span>2+</span><strong>{percent(values.at_least_2)}</strong><i style={{ width: `${Math.min(100, ((values.at_least_2 ?? 0) / max2) * 100)}%` }} /></div>
                <div><span>3+</span><strong>{percent(values.at_least_3)}</strong><i style={{ width: `${Math.min(100, ((values.at_least_3 ?? 0) / max3) * 100)}%` }} /></div>
                <div><span>4+</span><strong>{percent(values.at_least_4)}</strong><i style={{ width: `${Math.min(100, ((values.at_least_4 ?? 0) / max4) * 100)}%` }} /></div>
                <div><span>5</span><strong>{percent(values.at_least_5)}</strong></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
