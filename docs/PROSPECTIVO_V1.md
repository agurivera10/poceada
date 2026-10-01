# PROSPECTIVO-V1

Target inicial: sorteo 317. Corte informativo: sorteo 316.

PROSPECTIVO-V1 separa deliberadamente tres problemas que no deben confundirse:

1. **selección**: si una regla histórica identifica un pool con más aciertos fuera de muestra;
2. **probabilidad**: si un modelo probabilístico mejora calibración frente a 10% uniforme;
3. **cobertura**: cómo repartir un presupuesto fijo entre tickets para modificar la distribución del máximo de aciertos.

## Experimento A — selección

Compara pools con geometría y presupuesto idénticos.

- `weighted15-historical-v1`: pool histórico fijado por la regla descriptiva 35/20/20/25. Se conserva como artefacto histórico; no se reconstruye una cola de ranking que no quedó documentada.
- `consensus15-lab-v1`: primeros 15 del consenso congelado de ocho modelos legítimos de LAB-V1.
- `random15-control-v1`: 15 números seleccionados de forma reproducible por orden SHA-256.
- `weighted-rate-v2`: challenger calculado de forma explícita usando tasas 2026, last10, last20 y last30. No reemplaza retrospectivamente al artefacto histórico.

Métrica primaria: `pool15_hits`.
Secundarias: máximo de aciertos por ticket, evento 3+, evento 4+, evento 5, resultado económico y percentil frente a shadows.

Las carteras Weighted, Consensus y Random usan la misma geometría K6-edge: los 15 números representan las 15 aristas de K6. Cada número aparece en exactamente dos tickets y cada par de tickets comparte exactamente un número.

## Experimento B — probabilidades

Compara probabilidades marginales por número.

- `uniform-baseline-v1`: P=0.10 para 00..99.
- `empirical-bayes-v1`: prior Beta(10,90) y evidencia 2026. La suma de las 100 probabilidades es exactamente 10.
- `ewma-hl20-v1`: tasa de aparición ponderada exponencialmente, half-life 20 sorteos. La suma de las 100 probabilidades es 10 por construcción.

Métrica primaria: Brier Score.
Secundarias: log loss, calibración, hits@10, hits@20 y hits@25.

## Control de cobertura

Se conserva también una rueda completa de seis números (`16,26,57,79,85,88`) como control de concentración. Tiene seis tickets y el mismo costo total, pero mucha mayor superposición.

Bajo el modelo nulo uniforme 10-de-100:

- K6-edge de 15 números: P(al menos un 4+) = 0.00152459516373242, aprox. 1 en 655.91.
- rueda completa de 6 números: P(al menos un 4+) = 0.0007247500193783428, aprox. 1 en 1379.79.

La expectativa de cantidad de tickets 4+ es la misma para cualquier conjunto de seis tickets individuales; lo que cambia con la geometría es la dependencia y, por tanto, la probabilidad de que exista al menos un ticket ganador.

## Shadows

Antes del resultado se congela un lote de 1.000 controles Random-15 con:

- mismo pool size: 15;
- misma geometría K6-edge;
- mismos 6 tickets;
- mismo costo;
- semillas derivadas de una regla SHA-256 documentada.

No es necesario persistir 30.000 números antes del sorteo: el batch congelado contiene la regla generadora, seed inicial, cantidad y hash, por lo que los 1.000 controles son regenerables exactamente.

## Regla de interpretación

Una buena performance de Weighted o Consensus en uno o pocos sorteos no se interpreta como evidencia predictiva. La evidencia se acumula de forma prospectiva y se compara con controles de igual presupuesto y geometría.
