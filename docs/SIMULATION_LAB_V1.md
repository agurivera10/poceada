# SIMULATION LAB V1

## Qué resuelve

Simulation Lab separa el cómputo exploratorio de la evidencia prospectiva. Permite correr desde miles hasta decenas de millones de iteraciones sin guardar cada sorteo sintético.

La UI está en `/simulaciones` y la ejecución masiva se dispara desde el workflow **Simulation Lab** de GitHub Actions.

## Motor

- Python 3.13
- NumPy 2.5.3 fijado
- RNG reproducible por seed
- 8 shards paralelos
- histogramas y contadores agregados
- SHA-256 por shard y SHA-256 final

## Presets ejecutables V1

### `portfolio-null-geometry-v1`
Compara bajo azar puro:
- K6 Edge con 15 números;
- rueda completa de 6;
- 6 tickets completamente disjuntos.

Mide 3+, 4+, 5, múltiples 4+ y distribución del máximo de hits.

### `selection-shadow-v1`
Genera un pool aleatorio de 15 números y lo distribuye con K6 Edge. Sirve para construir distribuciones nulas de selección y cobertura.

### `null-season-patterns-v1`
Simula temporadas de 267 sorteos y mide cuánto pueden crecer por azar:
- frecuencia máxima;
- atraso máximo;
- racha máxima.

### `multiple-testing-redteam-v1`
En cada universo sin señal prueba frequency, last30, last10, delay y cold. Registra tanto cada modelo como el mejor de los cinco, para medir el sesgo de seleccionar retrospectivamente el ganador del backtest.

## Preset en diseño

`bankroll-risk-v1` queda registrado como familia de experimento, pero no se ejecuta hasta fijar supuestos de payouts y horizonte financiero. No se deben inventar premios faltantes.

## Cómo correr una simulación

1. GitHub → Actions → **Simulation Lab**.
2. Run workflow.
3. Elegir preset.
4. Definir total de iteraciones.
5. Definir seed base.
6. El workflow divide automáticamente el total en 8 shards.
7. El job `merge` produce `simulation-result.json` como artifact.

## Sincronización automática a Supabase

Es opcional. Si querés que una corrida aparezca automáticamente en `/simulaciones`, configurar en GitHub:

`Settings → Secrets and variables → Actions`

Repository secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

La service role es una credencial privada y **nunca** debe ir en Vercel como `NEXT_PUBLIC_*`, en código, en commits o en el navegador.

Si los secrets no existen, la simulación igualmente corre y deja su artifact; simplemente omite el sync.

## Regla estadística

Usar cálculo exacto cuando sea viable. Monte Carlo debe validar lo exacto o resolver distribuciones/procesos más complejos; no reemplazar una probabilidad cerrada por ruido de simulación sin necesidad.
