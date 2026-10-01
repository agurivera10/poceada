# Render activation checklist

After the Blueprint is created in Render:

1. Set `SUPABASE_SERVICE_ROLE_KEY` on both `poceada-lab` and `poceada-compute`.
2. Set `LAB_ADMIN_PASSWORD` on `poceada-lab`.
3. Let Render generate `LAB_SESSION_SECRET`.
4. Create a Render API key and set it as `RENDER_API_KEY` on `poceada-lab`.
5. Confirm `RENDER_WORKFLOW_TASK=poceada-compute/process_job`.
6. Open `/simulaciones`, unlock admin, and dispatch the acceptance run.
7. Verify `simulation_jobs.execution_backend = RENDER_WORKFLOW` and a `dispatch_ref` beginning with the Render task-run ID.
8. Verify progress increments, chunks are persisted, and the final job reaches `COMPLETED` with a SHA-256.

Do not expose any service-role or Render API key with `NEXT_PUBLIC_`.
