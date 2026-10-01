-- SIMULATION LAB V1 presets + PROSPECTIVO draw 317 evaluation registration.

insert into public.simulation_presets(slug,name,category,description,engine_version,default_iterations,max_recommended_iterations,default_config)
values
('portfolio-null-geometry-v1','Portfolio Null Geometry','PORTFOLIO_GEOMETRY','Compara carteras de tickets bajo sorteos 10-de-100 perfectamente aleatorios. Valida probabilidades exactas y eventos 3+/4+/5.','SIM_ENGINE_V1',10000000,100000000,'{"chunk_size":100000,"exact_when_available":true,"metrics":["p3plus","p4plus","p5","multiple4plus"]}'::jsonb),
('null-season-patterns-v1','Null Season Patterns','NULL_HISTORY','Genera temporadas sintéticas con la misma cantidad de sorteos para medir frecuencias máximas, atrasos, rachas y falsos patrones esperables por azar.','SIM_ENGINE_V1',100000,1000000,'{"draws_per_season":267,"numbers_per_draw":10,"universe":100,"metrics":["max_frequency","max_delay","max_streak"]}'::jsonb),
('selection-shadow-v1','Selection Shadow Lab','SELECTION_SHADOW','Genera pools aleatorios con la misma geometría y presupuesto que LAB para obtener percentiles de selección fuera de muestra.','SIM_ENGINE_V1',1000000,10000000,'{"pool_size":15,"ticket_count":6,"ticket_size":5,"geometry":"K6_EDGE_15"}'::jsonb),
('multiple-testing-redteam-v1','Multiple Testing Red Team','MULTIPLE_TESTING','Simula historiales sin señal y repite el proceso de búsqueda de modelos para cuantificar cuántos hallazgos aparentes surgen por data mining.','SIM_ENGINE_V1',100000,1000000,'{"family":"model_search_null","report_best_of_search":true,"corrections":["holm","benjamini_hochberg"]}'::jsonb),
('bankroll-risk-v1','Bankroll Risk Lab','BANKROLL','Simula trayectorias económicas, drawdown, rachas sin premio y riesgo de ruina para presupuestos definidos, sin asumir ventaja predictiva.','SIM_ENGINE_V1',1000000,10000000,'{"ticket_price_ars":2000,"tickets_per_draw":6,"metrics":["roi","max_drawdown","no_prize_streak","ruin_probability"]}'::jsonb)
on conflict (slug) do update set
  name=excluded.name,description=excluded.description,engine_version=excluded.engine_version,
  default_iterations=excluded.default_iterations,max_recommended_iterations=excluded.max_recommended_iterations,
  default_config=excluded.default_config,active=true;

insert into public.evaluation_protocols(experiment_id,protocol_version,metric_definitions,formulas,git_commit_sha)
select e.id,'EVALUATION_V1',
  case when e.slug='prospectivo-probability-v1' then
    '{"primary":"brier_score","secondary":["log_loss","winner_probability_mass","hits_at_10","pool15_hits","hits_at_20","hits_at_25"],"portfolio":["max_hits","tickets_3plus","tickets_4plus","tickets_5","roi"]}'::jsonb
  else
    '{"primary":"pool15_hits","secondary":["hits_at_10","hits_at_20","hits_at_25"],"portfolio":["max_hits","tickets_3plus","tickets_4plus","tickets_5"],"shadow_percentiles":["pool15_hits","max_hits","tickets_4plus"]}'::jsonb
  end,
  '{"brier":"mean((p-y)^2) over 100 numbers","log_loss":"mean binary cross entropy; probabilities clipped to [1e-12,1-1e-12]","hits_at_k":"winning numbers with rank<=k; only if run has >=k ranks","pool15_hits":"winning numbers with rank<=15","shadow_percentile":"100*(count(control<observed)+0.5*count(control=observed))/N","finance":"ROI and net only when all required payout tiers are known"}'::jsonb,
  'cdb9cf22ac5002a3f12d905c3e8253aa9a891050'
from public.experiments e
where e.slug in ('prospectivo-probability-v1','prospectivo-selection-v1')
on conflict (experiment_id) do nothing;

update public.evaluation_protocols ep
set frozen_at=now()
where ep.frozen_at is null
  and ep.experiment_id in (select id from public.experiments where slug in ('prospectivo-probability-v1','prospectivo-selection-v1'));

-- Materialize the 1,000 draw-317 controls from the preregistered rule when the batch exists.
-- This must run before shadow_portfolio_guard is active on a fresh reconstruction,
-- or be inserted in the same trusted bootstrap transaction.
with batch as (
  select * from public.shadow_batches where target_draw_number=317 order by created_at desc limit 1
), seeds as (
  select b.id as batch_id, i as shadow_index, b.seed_start + i as seed
  from batch b cross join generate_series(1,b.shadow_count) i
), ranked as (
  select s.batch_id,s.shadow_index,s.seed,n,
         row_number() over(partition by s.batch_id,s.shadow_index order by encode(extensions.digest(('POCEADA|317|SHADOW|'||s.seed::text||'|'||lpad(n::text,2,'0'))::bytea,'sha256'),'hex'), n) as rn
  from seeds s cross join generate_series(0,99) n
), pools as (
  select batch_id,shadow_index,seed,array_agg(n::smallint order by rn) filter (where rn<=15) as pool
  from ranked group by batch_id,shadow_index,seed
), shaped as (
  select batch_id,shadow_index,seed,pool,
    jsonb_build_array(
      to_jsonb(array[pool[1],pool[2],pool[3],pool[4],pool[5]]),
      to_jsonb(array[pool[1],pool[6],pool[7],pool[8],pool[9]]),
      to_jsonb(array[pool[2],pool[9],pool[10],pool[11],pool[12]]),
      to_jsonb(array[pool[3],pool[8],pool[10],pool[13],pool[14]]),
      to_jsonb(array[pool[5],pool[7],pool[12],pool[13],pool[15]]),
      to_jsonb(array[pool[4],pool[6],pool[11],pool[14],pool[15]])
    ) as tickets
  from pools
)
insert into public.shadow_portfolios(batch_id,shadow_index,seed,pool_numbers,tickets,portfolio_sha256)
select batch_id,shadow_index,seed,pool,tickets,
       internal.sha256_hex(batch_id::text||'|'||shadow_index::text||'|'||seed::text||'|'||pool::text||'|'||tickets::text)
from shaped
on conflict (batch_id,shadow_index) do nothing;
