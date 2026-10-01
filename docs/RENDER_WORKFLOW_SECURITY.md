# Render Workflow security boundary

Public browser code receives only the Supabase publishable key.

Server-side only:

- `SUPABASE_SERVICE_ROLE_KEY`
- `LAB_ADMIN_PASSWORD`
- `LAB_SESSION_SECRET`
- `RENDER_API_KEY`

The browser cannot call Render directly. It calls the authenticated Next.js API, which creates a durable Supabase job and then dispatches Render server-side.

The Render task itself receives only the `job_id`; it reads the frozen job configuration from Supabase using the service role.
