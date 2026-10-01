# POCEADA LAB

Laboratorio auditable para estudiar la Poceada Correntina con separación estricta entre datos, selección, geometría de tickets, simulación, evaluación prospectiva y economía.

## Estado actual

- DATA‑V1 en Supabase con sorteos 50–316: 267 sorteos y 2.670 números.
- SCIENCE CORE V1: snapshots, hashes, seeds, anti-leakage e inmutabilidad.
- PROSPECTIVO‑V1 congelado para el sorteo 317 con Selection V1 + Probability V1.
- EVALUATION_V1 preregistrado: Brier, Log Loss, hits@K, portfolios, payouts y percentiles.
- 1.000 Random‑15 shadows materializados para el 317.
- SIM_ENGINE_V2: premios 2/3/4/5 separados en probabilidades de evento y expectativas de tickets.
- Python Compute Plane: cola persistente, workers, leases, heartbeat, cancelación, retry, chunks y progreso Realtime.
- Portfolio Optimizer: búsqueda geométrica + probabilidad exacta 10-de-100 para pools pequeños.
- Frontend Next.js: `/`, `/datos`, `/ciencia`, `/simulaciones`, `/auditoria`.
- CI: invariantes científicos, Monte Carlo V2, optimizer, worker compile, TypeScript y build.

## Principios

1. Supabase es la fuente de verdad.
2. Ninguna discrepancia se corrige silenciosamente.
3. Los modelos prospectivos se congelan antes del resultado.
4. Toda estrategia se compara contra controles con el mismo presupuesto y geometría.
5. Cuando existe solución combinatoria exacta, es benchmark de Monte Carlo.
6. Simulación exploratoria y evidencia prospectiva son capas separadas.
7. 2, 3, 4 y 5 aciertos se miden por separado.
8. Probabilidad de evento y cantidad esperada de tickets no se mezclan.
9. El criterio final incluye calibración, cobertura, ROI, drawdown y riesgo.
10. Frecuencia histórica no se interpreta como deuda o garantía futura.

## Arquitectura

```text
Next.js /simulaciones
        |
        v
Supabase durable queue + Realtime
        |
        v
Python worker(s) / NumPy
        |
        +--> chunks + progress + heartbeat
        +--> metrics + histograms + hashes
        v
Supabase -> UI
```

GitHub queda para código, CI, migraciones y versionado. GitHub Actions sigue disponible como fallback de cómputo, pero ya no es requisito para operar Simulation Lab.

## Stack

- Next.js / React / TypeScript
- Supabase / Postgres / Realtime
- Python 3.13 / NumPy 2.5.3
- Docker para workers portables
- Vercel para la UI
- GitHub para código + CI

## Variables

Frontend público:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Servidor Next.js, nunca `NEXT_PUBLIC_`:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role>
LAB_ADMIN_PASSWORD=<strong-password>
LAB_SESSION_SECRET=<random-64-hex>
```

Vercel aporta `VERCEL_GIT_COMMIT_SHA`; fuera de Vercel se puede usar `SIMULATION_GIT_SHA`.

Worker Python:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role>
WORKER_ID=poceada-worker-01
WORKER_NAME="POCEADA Compute 01"
WORKER_POLL_SECONDS=2
```

Nunca exponer `service_role` en navegador, repo o variables `NEXT_PUBLIC_*`.

## Desarrollo

```bash
npm install
npm run dev
npm run test:science
npm run typecheck
npm run build
```

Worker:

```bash
pip install -r simulations/requirements.txt
python -m simulations.worker
```

Docker:

```bash
docker build -f simulations/Dockerfile -t poceada-worker .
docker run --rm --env-file .env.worker poceada-worker
```

## Simulation Lab V2

Presets principales:

- `portfolio-null-geometry-v1`
- `selection-shadow-v1`
- `null-season-patterns-v1`
- `multiple-testing-redteam-v1`
- `portfolio-optimizer-v1`

`bankroll-risk-v1` permanece registrado para ECON‑V1 cuando estén cargados payouts oficiales suficientes.

La UI permite lanzar desde 100K hasta 1B iteraciones, ver cola y workers, seguir progreso en vivo, cancelar y reintentar.

Detalles operativos: `docs/PYTHON_COMPUTE_PLANE.md`.

## Roadmap

- NULL LAB end-to-end: medir data-mining false positives sobre historiales sintéticos.
- COVERAGE‑V2: optimización exacta/heurística multiobjetivo para 2/3/4/5.
- METRICS‑V2: calibration curves, confidence sequences y percentiles acumulados.
- ECON‑V1: payouts oficiales, ROI, drawdown, bankroll y riesgo de ruina.
- RANDOMNESS‑V1: uniformidad, intervalos, independencia y coocurrencias con corrección múltiple.
