# FEATURES-V1

Target inaugural: sorteo 317. Corte: 316.

Cada snapshot contiene exactamente una fila para cada número 00..99 y se calcula sólo con el dataset congelado correspondiente.

## Variables

- `freq_total`: apariciones en todo el dataset snapshot.
- `freq_2025`: apariciones entre sorteos 50..204.
- `freq_2026`: apariciones entre sorteos 205..316.
- `last10`, `last20`, `last30`: apariciones en las últimas 10/20/30 observaciones del corte.
- `delay_current`: cantidad de sorteos transcurridos desde la última aparición, con 0 si apareció en el sorteo de corte.
- `max_delay_2026`: máxima racha de ausencias dentro de 2026, incluyendo prefijo y sufijo del período observado.
- `current_streak`: cantidad de sorteos consecutivos terminando en el corte en los que apareció el número.
- `max_streak_2026`: máxima racha consecutiva de apariciones en 2026.
- `ewma_hl20`: tasa de aparición ponderada exponencialmente con half-life de 20 sorteos.
- `weighted_rate_v2`: `0.35*(freq_2026/112) + 0.20*(last10/10) + 0.20*(last20/20) + 0.25*(last30/30)`.
- `empirical_bayes_p`: posterior media con prior `Beta(10,90)`: `(10 + freq_2026)/(100 + 112)`.
- `freq_2026_z`: `(freq_2026 - 11.2)/sqrt(112*0.1*0.9)`; descriptivo bajo marginal p=0.10.
- `annual_rate_delta`: `(freq_2026/112) - (freq_2025/155)`.

## Propiedades matemáticas

`empirical_bayes_p` suma exactamente 10 sobre los 100 números, porque el prior aporta masa total 1000 y los 112 sorteos aportan exactamente 1120 apariciones.

`ewma_hl20` también suma 10: en cada sorteo existen exactamente 10 números seleccionados y todos los números comparten el mismo peso temporal para esa observación.

`weighted_rate_v2` es un score descriptivo y no se interpreta como probabilidad.

## Anti-leakage

El snapshot sólo puede congelarse si su dataset snapshot está congelado exactamente hasta `trained_through_draw_number`. Para el primer prospectivo: `trained_through=316`, `target=317`.
