begin;

create table if not exists public.portfolio_geometry_metrics (
  portfolio_id uuid primary key references public.portfolios(id) on delete cascade,
  geometry_family text not null,
  unique_numbers smallint not null check (unique_numbers between 5 and 30),
  unique_four_subsets smallint not null check (unique_four_subsets >= 0),
  duplicate_four_subsets smallint not null check (duplicate_four_subsets >= 0),
  max_pairwise_overlap smallint not null check (max_pairwise_overlap between 0 and 5),
  min_number_usage smallint not null check (min_number_usage >= 1),
  max_number_usage smallint not null check (max_number_usage >= min_number_usage),
  p_at_least_3 double precision not null check (p_at_least_3 between 0 and 1),
  p_at_least_4 double precision not null check (p_at_least_4 between 0 and 1),
  p_at_least_5 double precision not null check (p_at_least_5 between 0 and 1),
  p_multiple_4plus double precision not null check (p_multiple_4plus between 0 and 1),
  expected_4plus_tickets double precision not null check (expected_4plus_tickets >= 0),
  null_model text not null default 'UNIFORM_10_OF_100',
  calculation_method text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.shadow_batches (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete restrict,
  target_draw_number integer not null check (target_draw_number > 0),
  trained_through_draw_number integer not null check (trained_through_draw_number > 0 and trained_through_draw_number < target_draw_number),
  shadow_count integer not null check (shadow_count > 0),
  pool_size smallint not null check (pool_size between 5 and 100),
  ticket_count smallint not null check (ticket_count > 0),
  ticket_size smallint not null default 5 check (ticket_size = 5),
  generator_version text not null,
  geometry_template text not null,
  seed_start bigint not null,
  seed_rule text not null,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config)='object'),
  batch_sha256 text check (batch_sha256 is null or batch_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  frozen_at timestamptz
);

create index if not exists shadow_batches_experiment_id_idx on public.shadow_batches(experiment_id);
create index if not exists shadow_batches_target_draw_idx on public.shadow_batches(target_draw_number);

alter table public.portfolio_geometry_metrics enable row level security;
alter table public.shadow_batches enable row level security;

grant select on public.portfolio_geometry_metrics, public.shadow_batches to anon, authenticated;
grant select, insert, update, delete on public.portfolio_geometry_metrics, public.shadow_batches to service_role;

create policy "public read portfolio geometry metrics" on public.portfolio_geometry_metrics for select to anon, authenticated using (true);
create policy "public read shadow batches" on public.shadow_batches for select to anon, authenticated using (true);

create or replace function internal.guard_portfolio_geometry_metrics()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  pid uuid;
  pfrozen timestamptz;
begin
  pid := case when tg_op='DELETE' then old.portfolio_id else new.portfolio_id end;
  select p.frozen_at into pfrozen from public.portfolios p where p.id=pid;
  if pfrozen is not null then raise exception 'portfolio % is frozen; geometry metrics are immutable', pid; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;

create trigger portfolio_geometry_metrics_guard
before insert or update or delete on public.portfolio_geometry_metrics
for each row execute function internal.guard_portfolio_geometry_metrics();

create or replace function internal.guard_shadow_batch()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  exp_frozen timestamptz;
begin
  if tg_op='DELETE' then
    if old.frozen_at is not null then raise exception 'frozen shadow batch % cannot be deleted', old.id; end if;
    return old;
  end if;
  if old.frozen_at is not null then raise exception 'frozen shadow batch % cannot be modified', old.id; end if;
  if old.frozen_at is null and new.frozen_at is not null then
    select e.frozen_at into exp_frozen from public.experiments e where e.id=new.experiment_id;
    if exp_frozen is null then raise exception 'shadow batch requires a frozen experiment'; end if;
    new.batch_sha256 := internal.sha256_hex(
      new.experiment_id::text || '|' || new.target_draw_number::text || '|' ||
      new.trained_through_draw_number::text || '|' || new.shadow_count::text || '|' ||
      new.pool_size::text || '|' || new.ticket_count::text || '|' || new.ticket_size::text || '|' ||
      new.generator_version || '|' || new.geometry_template || '|' || new.seed_start::text || '|' ||
      new.seed_rule || '|' || new.config::text
    );
  end if;
  return new;
end;
$function$;

create trigger shadow_batch_guard
before delete or update on public.shadow_batches
for each row execute function internal.guard_shadow_batch();

create or replace function internal.guard_portfolio()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  run_frozen timestamptz;
  ticket_count integer;
  bad_ticket_count integer;
  total_cost numeric;
  ticket_blob text;
  geometry_count integer;
begin
  if tg_op = 'DELETE' then
    if old.frozen_at is not null then raise exception 'frozen portfolio % cannot be deleted', old.id; end if;
    return old;
  end if;
  if old.frozen_at is not null then raise exception 'frozen portfolio % cannot be modified', old.id; end if;

  if old.frozen_at is null and new.frozen_at is not null then
    select r.frozen_at into run_frozen from public.model_runs r where r.id = new.run_id;
    if run_frozen is null then raise exception 'portfolio requires a frozen model run'; end if;

    select count(*), coalesce(sum(t.cost_ars),0),
           count(*) filter (where coalesce(n.number_count,0) <> 5),
           string_agg(t.ticket_index::text || ':' || coalesce(n.numbers_text,''), '|' order by t.ticket_index)
      into ticket_count, total_cost, bad_ticket_count, ticket_blob
    from public.tickets t
    left join lateral (
      select count(*) as number_count, string_agg(tn.number::text, ',' order by tn.position) as numbers_text
      from public.ticket_numbers tn where tn.ticket_id = t.id
    ) n on true
    where t.portfolio_id = new.id;

    if ticket_count < 1 or bad_ticket_count > 0 then
      raise exception 'portfolio % requires at least one ticket and exactly 5 numbers per ticket', new.id;
    end if;
    if total_cost <> new.budget_ars then
      raise exception 'portfolio % budget % must equal committed ticket cost %', new.id, new.budget_ars, total_cost;
    end if;
    if exists (select 1 from public.tickets t where t.portfolio_id = new.id and t.cost_ars <> new.ticket_price_ars) then
      raise exception 'all tickets must use portfolio ticket_price_ars';
    end if;
    if new.protocol_version = 'PROSPECTIVE_SELECTION_V1' then
      select count(*) into geometry_count from public.portfolio_geometry_metrics g where g.portfolio_id=new.id;
      if geometry_count <> 1 then raise exception 'PROSPECTIVE_SELECTION_V1 portfolio requires exact geometry metrics before freeze'; end if;
    end if;

    new.portfolio_sha256 := internal.sha256_hex(
      new.run_id::text || '|' || new.strategy || '|' || new.ticket_price_ars::text || '|' || new.budget_ars::text || '|' ||
      new.optimizer_seed::text || '|' || new.config::text || '|' || coalesce(ticket_blob,'')
    );
  end if;
  return new;
end;
$function$;

commit;
