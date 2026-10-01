# EVALUATION + SIMULATION V1

## Propósito

Este protocolo fija **antes del resultado del sorteo 317** cómo se evaluarán los runs prospectivos y cómo se separarán de las simulaciones exploratorias.

## EVALUATION_V1

### Resultado binario por número

Para cada número `i` de 00 a 99:

- `y_i = 1` si el número aparece entre los 10 extraídos.
- `y_i = 0` en caso contrario.

### Brier Score — métrica primaria probabilística

`Brier = (1/100) * Σ_i (p_i - y_i)^2`

Menor es mejor. El baseline uniforme `p_i = 0.10` produce Brier 0.09 en cualquier sorteo válido de exactamente 10 números.

### Log Loss

`LogLoss = -(1/100) * Σ_i [y_i ln(p_i*) + (1-y_i) ln(1-p_i*)]`

con `p_i* = clip(p_i, 1e-12, 1-1e-12)`.

Menor es mejor.

### Probability mass on winners

`Σ p_i` únicamente sobre los 10 números ganadores. El baseline uniforme vale exactamente 1.0.

### Ranking metrics

- `hits_at_10`: ganadores presentes entre ranks 1–10.
- `pool15_hits`: ganadores presentes entre ranks 1–15.
- `hits_at_20`: ganadores presentes entre ranks 1–20.
- `hits_at_25`: ganadores presentes entre ranks 1–25.

Una métrica sólo se computa si el run congelado contiene al menos K posiciones.

### Tickets y portfolio

Para cada ticket se registra el número exacto de hits 0–5. Por portfolio:

- `max_hits`
- `tickets_3plus`
- `tickets_4plus`
- `tickets_5`
- costo comprometido
- retorno bruto, neto y ROI **sólo cuando los payouts necesarios están cargados**.

Un payout faltante no se interpreta como premio cero. Se marca `payout_complete = false` y ROI/neto permanecen nulos.

### Percentiles contra shadows

Para portfolios K6_EDGE_15 del mismo target se comparan:

- `pool15_hits`
- `max_hits`
- `tickets_4plus`

contra los 1.000 controles congelados del batch prospectivo.

Percentil con empates por mid-rank:

`100 * (count(control < observed) + 0.5 * count(control = observed)) / N`

El percentil es descriptivo; no convierte un único sorteo en evidencia de ventaja.

## SIM_ENGINE_V1

### Regla general

Cuando existe una solución combinatoria exacta, el valor exacto es el benchmark y Monte Carlo actúa como validación. Se simula cuando interesa una distribución compleja, un proceso temporal, búsqueda múltiple, riesgo económico o una escala donde la enumeración completa no es práctica.

### Sharding

Las corridas grandes se dividen en 8 shards. Cada shard recibe una seed determinista derivada de la seed base. El resultado final conserva:

- cantidad total de iteraciones;
- seeds;
- histogramas;
- contadores;
- probabilidades derivadas;
- hash SHA-256 por shard;
- hash SHA-256 agregado.

No es necesario persistir cada sorteo sintético.

### Presets V1

1. `portfolio-null-geometry-v1`: compara K6 Edge, rueda 6 y seis tickets disjuntos bajo 10-de-100 uniforme.
2. `selection-shadow-v1`: pool aleatorio de 15 + geometría K6 contra un sorteo independiente.
3. `null-season-patterns-v1`: temporadas sintéticas de 267 sorteos; máximos de frecuencia, atraso y racha.
4. `multiple-testing-redteam-v1`: simula historiales sin señal y registra el mejor resultado entre varias reglas de selección para medir data-mining aparente.
5. `bankroll-risk-v1`: reservado para trayectorias financieras cuando existan supuestos/payouts explícitos.

## Separación de mundos

`PROSPECTIVO` y `SIMULATION LAB` no son intercambiables.

- Un run prospectivo queda congelado antes del sorteo real.
- Una simulación puede explorar hipótesis libremente, pero no reescribe un run prospectivo.
- Cambiar una fórmula crea una nueva versión del protocolo.
