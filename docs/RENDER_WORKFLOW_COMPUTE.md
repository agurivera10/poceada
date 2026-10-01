# Render Workflow Compute Plane

POCEADA LAB usa Render Workflows como backend de cómputo on-demand para Simulation Lab.

## Flujo

1. `/simulaciones` crea un `simulation_job` en Supabase.
2. La API server-side dispara `POST https://api.render.com/v1/task-runs`.
3. Se usa `idempotencyKey=poceada-simulation-<job_id>` para que un retry HTTP no duplique el task run.
4. Render inicia `poceada-compute/process_job` en compute `flex`.
5. La tarea reclama exclusivamente ese `job_id` mediante `claim_simulation_job_by_id`.
6. Python ejecuta Monte Carlo u optimización, escribe chunks, métricas, histogramas y SHA-256 en Supabase.
7. La app recibe progreso por Supabase Realtime.
8. El task run termina y Render libera el compute.

## Por qué Workflows

- No necesita un worker 24/7.
- Cada corrida tiene un task run independiente.
- `flex` factura CPU/RAM efectivamente usados.
- Los jobs pueden durar hasta 24 horas.
- El claim en Postgres evita ejecución duplicada.
- Supabase sigue siendo la fuente de verdad del estado científico.

## Servicios del Blueprint

`render.yaml` define:

- `poceada-lab`: web Next.js, plan Free.
- `poceada-compute`: workflow Python on-demand.

El workflow registra la tarea:

`poceada-compute/process_job`

## Secrets requeridos

En la web:

- `SUPABASE_SERVICE_ROLE_KEY`
- `LAB_ADMIN_PASSWORD`
- `LAB_SESSION_SECRET`
- `RENDER_API_KEY`

En el workflow:

- `SUPABASE_SERVICE_ROLE_KEY`

No exponer ninguno con prefijo `NEXT_PUBLIC_`.

## Auditoría

`simulation_jobs` conserva:

- `execution_backend`
- `dispatch_ref` (Render task run ID)
- `dispatched_at`
- `dispatch_metadata`
- seed
- commit SHA
- progreso
- runtime
- result SHA-256

Los resultados se guardan en `simulation_metrics`, `simulation_histograms` y `simulation_chunks`.

## Fallbacks

La cola sigue siendo compatible con:

- worker Python persistente,
- ejecución local,
- GitHub Actions.

Los experimentos prospectivos congelados no dependen del backend usado para las simulaciones exploratorias.
