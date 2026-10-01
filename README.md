# POCEADA LAB

Laboratorio auditable para estudiar la Poceada Correntina con una separación estricta entre datos, selección de números, geometría de tickets y resultados económicos.

## Estado actual

- DATA‑V1 en Supabase con sorteos 50–316.
- 267 sorteos canónicos y 2.670 números.
- 322 registros de evidencia de procedencia.
- 1 conflicto histórico abierto: fecha del sorteo 101.
- Frontend Next.js con `/`, `/datos` y `/auditoria`.
- RLS habilitado en todas las tablas públicas; la web es de solo lectura.
- CI en GitHub Actions: lockfile, instalación, typecheck y build.

## Principios

1. Una sola fuente de verdad: Supabase.
2. Ninguna discrepancia se corrige silenciosamente.
3. Los modelos prospectivos se congelan antes del sorteo.
4. Toda estrategia se compara contra controles aleatorios con el mismo presupuesto y geometría.
5. El criterio final incluye hit-rate, calibración, ROI, drawdown y riesgo.
6. Una frecuencia histórica no se interpreta como una deuda o garantía futura.

## Stack

- Next.js / React / TypeScript
- Supabase / Postgres
- Vercel
- GitHub Actions

## Variables de entorno

Copiar `.env.example` a `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

No usar ni exponer `service_role` en el frontend.

## Desarrollo

```bash
npm install
npm run dev
```

Validación:

```bash
npm run typecheck
npm run build
```

## Próximas fases

- PROSPECTIVO‑V1: registrar predicciones y carteras antes de cada sorteo.
- METRICS‑V2: Brier Score, Log Loss, calibración y percentiles frente a controles aleatorios.
- COVERAGE‑V2: optimización combinatoria exacta de carteras para 4+ aciertos.
- ECON‑V1: premios oficiales, costo, retorno, ROI y drawdown.
- RANDOMNESS‑V1: uniformidad, intervalos, independencia temporal y coocurrencias corregidas por múltiples comparaciones.
