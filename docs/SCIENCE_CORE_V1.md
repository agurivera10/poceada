# SCIENCE CORE V1

SCIENCE CORE V1 convierte POCEADA LAB de un conjunto de análisis históricos en un protocolo prospectivo auditable.

## Principio central

Un resultado sólo cuenta como evidencia prospectiva si la información que lo produjo existía y quedó congelada antes del sorteo objetivo.

Flujo obligatorio:

`dataset snapshot → feature snapshot → model run → predictions → freeze → portfolio → freeze → sorteo → evaluación`

## Reglas duras

- `trained_through_draw_number < target_draw_number` siempre.
- Un dataset congelado es inmutable y conserva una copia de cada sorteo que contenía.
- Un feature snapshot congelado contiene exactamente 100 filas, números 00–99.
- Un run `SCIENCE_CORE_V1` congelado contiene exactamente 100 rankings y 100 probabilidades.
- La masa de probabilidad de los 100 números debe sumar 10, porque el sorteo selecciona diez números.
- Cada run conserva Git SHA, dataset SHA-256, feature SHA-256 y random seed.
- Una vez congelados, modelos, snapshots, runs, predicciones, portfolios y tickets no pueden reescribirse.
- Un portfolio congelado exige 5 números únicos por ticket y que el presupuesto coincida con el costo comprometido.
- Los eventos de experimento son append-only.

## Preregistro de experimentos

Antes de congelar un experimento deben existir:

1. hipótesis y H0;
2. métrica primaria;
3. métricas secundarias;
4. inicio planificado y tamaño mínimo de muestra;
5. al menos un modelo candidato;
6. al menos un control;
7. versiones de modelos ya congeladas.

Después del freeze sólo puede cambiar el estado del ciclo de vida (`FROZEN → RUNNING → COMPLETED/ABORTED`). La hipótesis, métricas y protocolo no cambian.

## Dataset snapshot inicial

- Label: `DATA-V1 canonical through draw 316`
- Sorteos: 267
- Corte: 316
- SHA-256: `7c9d26235dbec169023ef7ff28241b6da30512f706d029be6dd60222905dc882`
- Conflicto histórico conocido: fecha del sorteo 101, mantenido abierto en DATA-V1.

## Controles base

Se registraron y congelaron dos versiones neutrales:

- `uniform-baseline-v1`: probabilidad marginal 0,10 para cada número.
- `random-ranking-control-v1`: misma probabilidad marginal, ranking aleatorio reproducible por seed.

Estos controles no intentan predecir. Sirven para medir si un modelo aporta información por encima de una referencia sin señal.

## Defensa contra leakage

La base impide congelar un run cuando el corte de entrenamiento alcanza o supera el sorteo objetivo. Además, el run debe apuntar a un feature snapshot y dataset snapshot congelados con el mismo corte.

## CI

`npm run test:science` verifica en cada push:

- aritmética del manifiesto DATA-V1;
- corte prospectivo;
- 100 probabilidades y masa total 10;
- geometría de tickets;
- presupuesto comprometido;
- formato SHA-256.

Los triggers de Postgres aplican las mismas ideas en la capa de persistencia.
