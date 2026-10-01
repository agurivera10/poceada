create or replace view public.science_run_integrity with (security_invoker=true) as
select r.id as run_id,
       r.experiment_id,
       r.model_version_id,
       r.run_kind,
       r.target_draw_number,
       r.trained_through_draw_number,
       r.frozen_at,
       count(p.number)::integer as prediction_count,
       count(p.probability)::integer as probability_count,
       sum(p.probability) as probability_sum,
       r.trained_through_draw_number < r.target_draw_number as leakage_cutoff_ok,
       r.dataset_sha256 is not null and r.features_sha256 is not null and r.run_hash is not null as hashes_complete,
       (
         r.frozen_at is not null
         and r.trained_through_draw_number < r.target_draw_number
         and r.dataset_sha256 is not null and r.features_sha256 is not null and r.run_hash is not null
         and case
           when r.protocol_version='SCIENCE_CORE_V1' then
             count(p.number)=100 and count(p.probability)=100 and abs(coalesce(sum(p.probability),0)-10.0)<=0.000000001
           when r.protocol_version='PROSPECTIVE_SELECTION_V1' then count(p.number)>=5
           else count(p.number)>0
         end
       ) as science_core_valid,
       r.protocol_version,
       (
         r.frozen_at is not null
         and r.trained_through_draw_number < r.target_draw_number
         and r.dataset_sha256 is not null and r.features_sha256 is not null and r.run_hash is not null
         and case
           when r.protocol_version='SCIENCE_CORE_V1' then
             count(p.number)=100 and count(p.probability)=100 and abs(coalesce(sum(p.probability),0)-10.0)<=0.000000001
           when r.protocol_version='PROSPECTIVE_SELECTION_V1' then count(p.number)>=5
           else count(p.number)>0
         end
       ) as protocol_valid
from public.model_runs r
left join public.model_predictions p on p.run_id=r.id
group by r.id;

create or replace view public.science_core_status with (security_invoker=true) as
select
  (select count(*) from public.experiments) as experiments,
  (select count(*) from public.experiments where frozen_at is not null) as frozen_experiments,
  (select count(*) from public.dataset_snapshots where frozen_at is not null) as frozen_dataset_snapshots,
  (select count(*) from public.feature_snapshots where frozen_at is not null) as frozen_feature_snapshots,
  (select count(*) from public.model_runs where frozen_at is not null) as frozen_runs,
  (select count(*) from public.science_run_integrity where frozen_at is not null and not protocol_valid) as invalid_frozen_runs,
  (select count(*) from public.portfolios where frozen_at is not null) as frozen_portfolios;

grant select on public.science_run_integrity, public.science_core_status to anon, authenticated, service_role;
