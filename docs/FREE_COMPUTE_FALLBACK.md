# Free compute fallback

`poceada-compute-free` is a Render Free web service used for end-to-end acceptance and smaller runs when Render Workflows is not yet configured.

- Endpoint `/health` is public and exposes only busy/idle state.
- Endpoint `/run` requires `COMPUTE_DISPATCH_TOKEN`.
- The service receives `SIM_WORKER_TOKEN`, not a Supabase master key.
- It atomically claims the exact Supabase `job_id` before doing work.
- If Render Workflows is configured, the application prefers Workflows and uses this service only as fallback.

This backend is not the intended engine for very large runs because free web instances can sleep and have tighter resource limits. Massive runs should use Render Workflows or another scaled Python backend.
