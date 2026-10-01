# Render Workflow references

Implementation targets the Render Workflows API and Python SDK available in October 2026:

- workflow task runtime: Python
- task compute plan: `flex`
- task timeout: up to 86,400 seconds
- run endpoint: `POST /v1/task-runs`
- cancel endpoint: `DELETE /v1/task-runs/{taskRunId}`
- dispatch idempotency key: one per POCEADA `job_id`

See Render's Workflows, task-run and Blueprint documentation for provider-specific behavior.
