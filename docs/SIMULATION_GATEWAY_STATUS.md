# Secure compute status

Architecture target:

`POCEADA LAB -> Simulation Gateway -> Supabase queue -> Python compute -> Simulation Gateway -> Supabase results`

Render Workflows is the preferred massive backend. Render Free Compute is an acceptance/smaller-run fallback. Neither backend requires a Supabase master credential.
