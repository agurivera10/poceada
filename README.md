# POCEADA LAB

Laboratorio auditable para estudiar la Poceada Correntina con una separación estricta entre datos, selección de números, geometría de tickets, simulación y resultados económicos.

## Estado actual

- DATA‑V1 en Supabase con sorteos 50–316.
- 267 sorteos canónicos y 2.670 números.
- 322 registros de evidencia de procedencia.
- 1 conflicto histórico abierto: fecha del sorteo 101.
- SCIENCE CORE V1 activo: snapshots, hashes, seeds, anti-leakage e inmutabilidad.
- PROSPECTIVO‑V1 congelado para el sorteo 317 con Selection V1 + Probability V1.
- EVALUATION_V1 preregistrado antes del resultado: Brier, Log Loss, hits@K, portfolios, payouts y percentiles contra shadows.
- 1.000 Random‑15 shadows materializados y congelados para el 317.
- SIMULATION LAB V1 con presets, ejecución shardada y registro resumido en Supabase.
- Frontend Next.js con `/`, `/datos`, `/ciencia`, `/simulaciones` y `/auditoria`.
- RLS habilitado en las tablas públicas; la web es de solo lectura.
- CI en GitHub Actions: invariantes científicos, smoke tests NumPy, typecheck y build.

## Principios

1. Una sola fuente de verdad: Supabase.
2. Ninguna discrepancia se corrige silenciosamente.
3. Los modelos prospectivos se congelan antes del sorteo.
4. Toda estrategia se compara contra controles aleatorios con el mismo presupuesto y geometría.
5. Cuando existe una probabilidad exacta, Monte Carlo la valida; no la reemplaza sin necesidad.
6. Las simulaciones exploratorias nunca reescriben una predicción prospectiva.
7. El criterio final incluye hit-rate, calibración, ROI, drawdown y riesgo.
8. Una frecuencia histórica no se interpreta como una deuda o garantía futura.

## Stack

- Next.js / React / TypeScript
- Supabase / Postgres
- Python 3.13 / NumPy 2.5.3
- Vercel
- GitHub Actions

## Variables de entorno

Copiar `.env.example` a `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

No usar ni exponer `service_role` en el frontend.

Para sincronización automática de simulaciones desde GitHub Actions, configurar como **Repository secrets** —no como variables públicas—:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Si esos secrets no están configurados, las simulaciones igualmente se ejecutan y dejan un artifact JSON verificable; simplemente no se importan automáticamente a Supabase.

## Desarrollo

```bash
npm install
npm run dev
```

Validación:

```bash
npm run test:science
npm run typecheck
npm run build
```

## Simulation Lab

Ejecutor manual:

`GitHub → Actions → Simulation Lab → Run workflow`

Presets V1 ejecutables:

- `portfolio-null-geometry-v1`
- `selection-shadow-v1`
- `null-season-patterns-v1`
- `multiple-testing-redteam-v1`

`bankroll-risk-v1` queda registrado como familia de investigación hasta fijar supuestos económicos explícitos.

## Próximas fases

- NULL LAB: temporadas sintéticas y end-to-end data-mining null.
- COVERAGE‑V2: optimización combinatoria exacta / CP-SAT de carteras para 4+.
- METRICS‑V2: calibración temporal, confidence sequences y percentiles acumulados.
- ECON‑V1: premios oficiales, costo, retorno, ROI, drawdown y bankroll.
- RANDOMNESS‑V1: uniformidad, intervalos, independencia temporal y coocurrencias corregidas por múltiples comparaciones.
