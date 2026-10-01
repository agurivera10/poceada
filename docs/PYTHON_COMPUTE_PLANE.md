# Python Compute Plane

POCEADA LAB separa la interfaz, el estado y el cómputo:

```text
Next.js /simulaciones
        |
        v
Supabase simulation_jobs
        |
        v
Python worker (NumPy)
        |
        +--> progress / heartbeat / chunks
        +--> metrics / histograms / SHA-256
        v
Supabase -> Realtime -> UI
```

## Por qué

- La app no necesita sostener requests largas.
- Cerrar el navegador no cancela una simulación.
- El worker puede moverse entre Railway, Render, Fly.io, VPS u otra plataforma sin cambiar la UI.
- `service_role` nunca llega al navegador.
- Los jobs son persistentes, cancelables y reintentables.
- Cada chunk tiene seed y SHA-256 reproducibles.

## Variables del worker

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role>
WORKER_ID=poceada-worker-01
WORKER_NAME="POCEADA Compute 01"
WORKER_POLL_SECONDS=2
# opcional
WORKER_CHUNK_ITERATIONS=1000000
```

Nunca usar `NEXT_PUBLIC_` para `SUPABASE_SERVICE_ROLE_KEY`.

## Ejecutar localmente

Desde la raíz del repo:

```bash
pip install -r simulations/requirements.txt
python -m simulations.worker
```

## Docker

```bash
docker build -f simulations/Dockerfile -t poceada-worker .
docker run --rm \
  -e SUPABASE_URL \
  -e SUPABASE_SERVICE_ROLE_KEY \
  -e WORKER_ID=poceada-worker-01 \
  -e WORKER_NAME="POCEADA Compute 01" \
  poceada-worker
```

## Variables privadas de la app

Además de las dos variables públicas de Supabase, el servidor Next.js necesita:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role>
LAB_ADMIN_PASSWORD=<strong-password>
LAB_SESSION_SECRET=<random-64-hex>
```

En Vercel `VERCEL_GIT_COMMIT_SHA` se usa automáticamente para congelar la versión de código de cada job. Fuera de Vercel puede definirse `SIMULATION_GIT_SHA`.

## Estados

```text
QUEUED -> CLAIMED -> RUNNING -> COMPLETED
                         |--> CANCELLING -> CANCELLED
                         |--> FAILED
                         |--> STALE
```

`lease_expires_at` + `heartbeat_at` evitan RUNNING eternos. Al reclamar trabajo, un worker limpia leases vencidos antes de tomar el siguiente job.

## Seguridad

- `anon` / `authenticated`: sólo `SELECT` de jobs, workers y eventos.
- `service_role`: escritura y RPCs de control.
- Los RPCs de mutación son `SECURITY INVOKER`, no `SECURITY DEFINER`.
- La app expone mutaciones sólo detrás de una cookie administrativa `HttpOnly` firmada con HMAC.
- El worker usa `service_role` únicamente en backend.

## Presets de cómputo

- `portfolio-null-geometry-v1`
- `selection-shadow-v1`
- `null-season-patterns-v1`
- `multiple-testing-redteam-v1`
- `portfolio-optimizer-v1`

SIM_ENGINE_V2 separa:

- probabilidad de evento `P(al menos un 2+/3+/4+/5)`;
- máximo exacto 2/3/4/5;
- eventos con múltiples tickets premiados;
- cantidad esperada de tickets exactamente 2/3/4/5;
- cantidad esperada de tickets 2+/3+/4+/5.

## Portfolio Optimizer

Para pools de hasta 22 números, el optimizador puede calcular de forma exacta la probabilidad de evento bajo un sorteo uniforme 10-de-100 enumerando todos los subconjuntos posibles dentro del pool y ponderándolos por combinatoria hipergeométrica.

El objetivo de búsqueda V1 es geométrico: maximizar subconjuntos únicos de cuatro, reducir overlap máximo y balancear el uso de números. No supone que el ranking histórico aumente la probabilidad real de un número.
