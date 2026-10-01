# Simulation gateway operations

Rotate a token by generating a new random value, storing only its SHA-256 digest in `simulation_api_tokens`, updating the corresponding Render environment variable, verifying one request, and then deactivating the old row.

Do not place live tokens, Render API keys, admin passwords, session secrets, or Supabase project secret keys in Git, issues, workflow logs, or client-side variables.
