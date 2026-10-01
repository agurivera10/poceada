# Simulation Gateway security model

POCEADA LAB does not expose a Supabase master credential to Render.

## Credentials

Two independent random credentials exist outside the repository:

- `LAB_SERVER_TOKEN` with role `APP`
- `SIM_WORKER_TOKEN` with role `WORKER`

Only their SHA-256 digests are stored in `simulation_api_tokens`. Live token values are never committed.

## APP scope

The application token can only request:

- create simulation job
- cancel job
- retry job
- mark a job as dispatched

## WORKER scope

The compute token can only request:

- claim a specific/next job
- heartbeat
- complete/fail/acknowledge cancellation
- worker presence
- simulation chunks
- simulation metrics
- simulation histograms
- stale lease cleanup

## Boundary

A Supabase Edge Function authenticates the narrow token, then performs the privileged database operation inside Supabase. Render receives no `service_role`/secret project key.

Browser code still receives only the normal Supabase publishable key. All job mutations remain behind the admin session and server-side gateway client.
