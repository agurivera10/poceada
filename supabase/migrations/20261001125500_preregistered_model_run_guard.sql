create or replace function internal.guard_model_run()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  exp_frozen timestamptz;
  model_frozen timestamptz;
  registered_model integer;
  fs_frozen timestamptz;
  fs_target integer;
  fs_trained integer;
  fs_dataset uuid;
  fs_hash text;
  ds_frozen timestamptz;
  ds_through integer;
  ds_hash text;
  prediction_count integer;
  probability_count integer;
  probability_sum double precision;
  pred_blob text;
begin
  if tg_op = 'DELETE' then
    if old.frozen_at is not null then raise exception 'frozen model run % cannot be deleted', old.id; end if;
    return old;
  end if;
  if old.frozen_at is not null then raise exception 'frozen model run % cannot be modified', old.id; end if;

  if old.frozen_at is null and new.frozen_at is not null then
    select e.frozen_at into exp_frozen from public.experiments e where e.id = new.experiment_id;
    select m.frozen_at into model_frozen from public.model_versions m where m.id = new.model_version_id;
    select count(*) into registered_model from public.experiment_models em
      where em.experiment_id=new.experiment_id and em.model_version_id=new.model_version_id;
    select f.frozen_at, f.target_draw_number, f.trained_through_draw_number, f.dataset_snapshot_id, f.snapshot_sha256
      into fs_frozen, fs_target, fs_trained, fs_dataset, fs_hash
    from public.feature_snapshots f where f.id = new.feature_snapshot_id;
    select d.frozen_at, d.through_draw_number, d.dataset_sha256
      into ds_frozen, ds_through, ds_hash
    from public.dataset_snapshots d where d.id = new.dataset_snapshot_id;

    if exp_frozen is null then raise exception 'model run requires a frozen experiment'; end if;
    if model_frozen is null then raise exception 'model run requires a frozen model version'; end if;
    if registered_model <> 1 then raise exception 'model version % was not preregistered in experiment %', new.model_version_id, new.experiment_id; end if;
    if fs_frozen is null or ds_frozen is null then raise exception 'model run requires frozen feature and dataset snapshots'; end if;
    if fs_target <> new.target_draw_number or fs_trained <> new.trained_through_draw_number then raise exception 'feature snapshot cutoff/target does not match model run'; end if;
    if fs_dataset <> new.dataset_snapshot_id or ds_through <> new.trained_through_draw_number then raise exception 'dataset snapshot lineage does not match model run'; end if;

    select count(*), count(p.probability), sum(p.probability),
           string_agg(p.number::text || ':' || p.rank::text || ':' || coalesce(p.probability::text,'') || ':' || coalesce(p.score::text,''), '|' order by p.number)
      into prediction_count, probability_count, probability_sum, pred_blob
    from public.model_predictions p where p.run_id = new.id;

    if new.protocol_version = 'SCIENCE_CORE_V1' then
      if prediction_count <> 100 or probability_count <> 100 then raise exception 'SCIENCE_CORE_V1 run requires 100 ranked probabilities; got predictions %, probabilities %', prediction_count, probability_count; end if;
      if abs(probability_sum - 10.0) > 0.000000001 then raise exception 'SCIENCE_CORE_V1 probabilities must sum to 10; got %', probability_sum; end if;
    elsif new.protocol_version = 'PROSPECTIVE_SELECTION_V1' then
      if prediction_count < 5 then raise exception 'PROSPECTIVE_SELECTION_V1 run requires at least 5 preregistered ranked selections'; end if;
    end if;

    new.dataset_sha256 := ds_hash;
    new.features_sha256 := fs_hash;
    new.run_hash := internal.sha256_hex(
      new.model_version_id::text || '|' || new.experiment_id::text || '|' || new.run_kind || '|' ||
      new.target_draw_number::text || '|' || new.trained_through_draw_number::text || '|' || new.git_commit_sha || '|' ||
      new.random_seed::text || '|' || new.config::text || '|' || coalesce(ds_hash,'') || '|' || coalesce(fs_hash,'') || '|' || coalesce(pred_blob,'')
    );
  end if;
  return new;
end;
$function$;
