# Supabase

El proyecto remoto de referencia es `oxjjmozpjbnawewdyuso`.

Las migraciones DATA‑V1 iniciales fueron aplicadas antes de incorporar este directorio al repositorio. SCIENCE CORE V1 sí queda versionado aquí de forma íntegra. No se debe reconstruir una base nueva únicamente con este directorio hasta exportar también las tres migraciones DATA‑V1 remotas (`data_v1_core`, `data_v1_fk_indexes`, `data_v1_conflict_guard`).

Reglas:

- todo DDL nuevo debe quedar en `supabase/migrations/`;
- seeds reproducibles en `supabase/seeds/`;
- nunca guardar `service_role` ni claves secretas en Git;
- tablas públicas expuestas al Data API requieren GRANT explícito + RLS;
- objetos congelados del protocolo científico no se reescriben.
