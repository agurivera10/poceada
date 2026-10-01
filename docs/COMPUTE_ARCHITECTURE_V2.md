# Compute Architecture V2

## Default backend

`RENDER_WORKFLOW`

Simulation Lab creates durable jobs in Supabase and dispatches a Render Workflow task on demand. The task receives only the Supabase `job_id`; all scientific configuration remains frozen in Postgres.

## Safety properties

- Render API dispatch uses an idempotency key derived from `job_id`.
- Postgres claims a job atomically by exact ID.
- A duplicated task run cannot execute the same queued job twice.
- Predictions and prospective runs are stored separately from exploratory simulations.
- Every simulation retains seed, Git SHA, execution backend, Render task-run ID, chunk hashes and final SHA-256.
- 2/3/4/5 prize-tier statistics distinguish event probability from expected ticket count.

## Backends

- `RENDER_WORKFLOW`: on-demand default.
- `PYTHON_WORKER`: persistent worker fallback.
- `GITHUB_ACTIONS`: batch/fallback path.
- `LOCAL`: development.

## Cost model

The Render Workflow `flex` task spins up for each run and deprovisions when finished. This avoids paying for an always-on background worker when the lab is idle.
