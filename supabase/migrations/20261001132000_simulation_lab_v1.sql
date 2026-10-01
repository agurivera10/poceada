-- SIMULATION LAB V1 + EVALUATION V1
-- Applied to production on 2026-10-01 before draw 317.

create table if not exists public.evaluation_protocols (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null unique references public.experiments(id) on delete cascade,
  protocol_version text not null,
  metric_definitions jsonb not null default '{}'::jsonb check (jsonb_typeof(metric_definitions)='object'),
  formulas jsonb not null default '{}'::jsonb check (jsonb_typeof(formulas)='object'),
  git_commit_sha text not null check (git_commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  protocol_sha256 text check (protocol_sha256 is null or protocol_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  frozen_at timestamptz
);

create table if not exists public.shadow_portfolios (
  batch_id uuid not null references public.shadow_batches(id) on delete cascade,
  shadow_index integer not null check (shadow_index >= 1),
  seed bigint not null,
  pool_numbers smallint[] not null check (cardinality(pool_numbers)=15),
  tickets jsonb not null check (jsonb_typeof(tickets)='array' and jsonb_array_length(tickets)=6),
  portfolio_sha256 text not null check (portfolio_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (batch_id, shadow_index),
  unique (batch_id, portfolio_sha256)
);

create table if not exists public.shadow_evaluations (
  batch_id uuid not null,
  shadow_index integer not null,
  draw_id bigint not null references public.draws(id) on delete cascade,
  pool_hits smallint not null check (pool_hits between 0 and 10),
  max_hits smallint not null check (max_hits between 0 and 5),
  tickets_3plus smallint not null check (tickets_3plus between 0 and 6),
  tickets_4plus smallint not null check (tickets_4plus between 0 and 6),
  tickets_5 smallint not null check (tickets_5 between 0 and 6),
  gross_return_ars numeric not null default 0 check (gross_return_ars >= 0),
  payout_complete boolean not null default false,
  evaluated_at timestamptz not null default now(),
  primary key (batch_id, shadow_index, draw_id),
  foreign key (batch_id, shadow_index) references public.shadow_portfolios(batch_id, shadow_index) on delete cascade
);

create table if not exists public.portfolio_shadow_comparisons (
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  draw_id bigint not null references public.draws(id) on delete cascade,
  batch_id uuid not null references public.shadow_batches(id) on delete cascade,
  metric_name text not null,
  observed_value double precision,
  control_mean double precision,
  control_sd double precision,
  percentile double precision check (percentile is null or (percentile >= 0 and percentile <= 100)),
  details jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (portfolio_id, draw_id, batch_id, metric_name)
);

create table if not exists public.simulation_presets (
  slug text primary key,
  name text not null,
  category text not null check (category in ('PORTFOLIO_GEOMETRY','NULL_HISTORY','SELECTION_SHADOW','MULTIPLE_TESTING','BANKROLL','RANDOMNESS','CUSTOM')),
  description text not null,
  engine_version text not null,
  default_iterations bigint not null check (default_iterations > 0),
  max_recommended_iterations bigint not null check (max_recommended_iterations >= default_iterations),
  default_config jsonb not null default '{}'::jsonb check (jsonb_typeof(default_config)='object'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.simulation_experiments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  preset_slug text references public.simulation_presets(slug) on delete set null,
  category text not null check (category in ('PORTFOLIO_GEOMETRY','NULL_HISTORY','SELECTION_SHADOW','MULTIPLE_TESTING','BANKROLL','RANDOMNESS','CUSTOM')),
  hypothesis text,
  engine_version text not null,
  git_commit_sha text not null check (git_commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config)='object'),
  requested_iterations bigint not null check (requested_iterations > 0),
  seed_base bigint not null,
  shard_count integer not null default 1 check (shard_count between 1 and 64),
  status text not null default 'DRAFT' check (status in ('DRAFT','FROZEN','QUEUED','RUNNING','COMPLETED','FAILED','ABORTED')),
  experiment_sha256 text check (experiment_sha256 is null or experiment_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  frozen_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.simulation_chunks (
  id uuid primary key default gen_random_uuid(),
  simulation_experiment_id uuid not null references public.simulation_experiments(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  iterations bigint not null check (iterations > 0),
  seed_start bigint not null,
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','COMPLETED','FAILED')),
  runtime_ms bigint check (runtime_ms is null or runtime_ms >= 0),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary)='object'),
  result_sha256 text check (result_sha256 is null or result_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (simulation_experiment_id, chunk_index)
);

create table if not exists public.simulation_metrics (
  simulation_experiment_id uuid not null references public.simulation_experiments(id) on delete cascade,
  metric_name text not null,
  metric_value double precision,
  standard_error double precision,
  quantiles jsonb not null default '{}'::jsonb check (jsonb_typeof(quantiles)='object'),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  computed_at timestamptz not null default now(),
  primary key (simulation_experiment_id, metric_name)
);

create table if not exists public.simulation_histograms (
  simulation_experiment_id uuid not null references public.simulation_experiments(id) on delete cascade,
  metric_name text not null,
  bin_edges jsonb not null check (jsonb_typeof(bin_edges)='array'),
  counts jsonb not null check (jsonb_typeof(counts)='array'),
  total_count bigint not null check (total_count >= 0),
  computed_at timestamptz not null default now(),
  primary key (simulation_experiment_id, metric_name)
);

alter table public.ticket_evaluations add column if not exists payout_known boolean not null default false;
alter table public.portfolio_results add column if not exists payout_complete boolean not null default false;
alter table public.portfolio_results add column if not exists tickets_5 integer not null default 0 check (tickets_5 >= 0);

create index if not exists shadow_evaluations_draw_idx on public.shadow_evaluations(draw_id);
create index if not exists shadow_portfolios_batch_seed_idx on public.shadow_portfolios(batch_id, seed);
create index if not exists portfolio_shadow_comparisons_draw_idx on public.portfolio_shadow_comparisons(draw_id);
create index if not exists simulation_experiments_status_idx on public.simulation_experiments(status, created_at desc);
create index if not exists simulation_chunks_experiment_idx on public.simulation_chunks(simulation_experiment_id, chunk_index);

alter table public.evaluation_protocols enable row level security;
alter table public.shadow_portfolios enable row level security;
alter table public.shadow_evaluations enable row level security;
alter table public.portfolio_shadow_comparisons enable row level security;
alter table public.simulation_presets enable row level security;
alter table public.simulation_experiments enable row level security;
alter table public.simulation_chunks enable row level security;
alter table public.simulation_metrics enable row level security;
alter table public.simulation_histograms enable row level security;

grant select on public.evaluation_protocols, public.shadow_portfolios, public.shadow_evaluations, public.portfolio_shadow_comparisons, public.simulation_presets, public.simulation_experiments, public.simulation_chunks, public.simulation_metrics, public.simulation_histograms to anon, authenticated;
grant all on public.evaluation_protocols, public.shadow_portfolios, public.shadow_evaluations, public.portfolio_shadow_comparisons, public.simulation_presets, public.simulation_experiments, public.simulation_chunks, public.simulation_metrics, public.simulation_histograms to service_role;

create policy "public read evaluation protocols" on public.evaluation_protocols for select to anon, authenticated using (true);
create policy "public read shadow portfolios" on public.shadow_portfolios for select to anon, authenticated using (true);
create policy "public read shadow evaluations" on public.shadow_evaluations for select to anon, authenticated using (true);
create policy "public read portfolio shadow comparisons" on public.portfolio_shadow_comparisons for select to anon, authenticated using (true);
create policy "public read simulation presets" on public.simulation_presets for select to anon, authenticated using (true);
create policy "public read simulation experiments" on public.simulation_experiments for select to anon, authenticated using (true);
create policy "public read simulation chunks" on public.simulation_chunks for select to anon, authenticated using (true);
create policy "public read simulation metrics" on public.simulation_metrics for select to anon, authenticated using (true);
create policy "public read simulation histograms" on public.simulation_histograms for select to anon, authenticated using (true);

create or replace function internal.guard_evaluation_protocol()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.frozen_at is not null then raise exception 'frozen evaluation protocol cannot be deleted'; end if;
    return old;
  end if;
  if old.frozen_at is not null then raise exception 'frozen evaluation protocol cannot be modified'; end if;
  if old.frozen_at is null and new.frozen_at is not null then
    if new.metric_definitions='{}'::jsonb or new.formulas='{}'::jsonb then raise exception 'evaluation protocol requires metrics and formulas'; end if;
    if not exists (select 1 from public.experiments e where e.id=new.experiment_id and e.frozen_at is not null) then raise exception 'evaluation protocol requires frozen experiment'; end if;
    new.protocol_sha256 := internal.sha256_hex(new.experiment_id::text||'|'||new.protocol_version||'|'||new.metric_definitions::text||'|'||new.formulas::text||'|'||new.git_commit_sha);
  end if;
  return new;
end $$;

create trigger evaluation_protocol_guard before update or delete on public.evaluation_protocols for each row execute function internal.guard_evaluation_protocol();

create or replace function internal.guard_simulation_experiment()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.frozen_at is not null then raise exception 'frozen simulation experiment cannot be deleted'; end if;
    return old;
  end if;
  if old.frozen_at is not null then
    if (to_jsonb(new)-array['status','completed_at']) <> (to_jsonb(old)-array['status','completed_at']) then raise exception 'frozen simulation definition is immutable'; end if;
    return new;
  end if;
  if old.frozen_at is null and new.frozen_at is not null then
    if new.status <> 'FROZEN' then raise exception 'simulation must enter FROZEN when definition is frozen'; end if;
    new.experiment_sha256 := internal.sha256_hex(new.slug||'|'||new.category||'|'||new.engine_version||'|'||new.git_commit_sha||'|'||new.config::text||'|'||new.requested_iterations::text||'|'||new.seed_base::text||'|'||new.shard_count::text);
  end if;
  return new;
end $$;

create trigger simulation_experiment_guard before update or delete on public.simulation_experiments for each row execute function internal.guard_simulation_experiment();

create or replace function internal.guard_shadow_portfolio_change()
returns trigger language plpgsql set search_path='' as $$
declare bid uuid; frozen timestamptz;
begin
  bid := case when tg_op='DELETE' then old.batch_id else new.batch_id end;
  select b.frozen_at into frozen from public.shadow_batches b where b.id=bid;
  if frozen is not null then raise exception 'shadow batch % is frozen; materialized shadow portfolios are immutable', bid; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create trigger shadow_portfolio_guard before insert or update or delete on public.shadow_portfolios for each row execute function internal.guard_shadow_portfolio_change();

create or replace function internal.compute_portfolio_economics()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.payout_complete then
    new.net_return_ars := new.gross_return_ars-new.total_cost_ars;
    new.roi := case when new.total_cost_ars=0 then null else new.net_return_ars/new.total_cost_ars end;
  else
    new.net_return_ars := null;
    new.roi := null;
  end if;
  return new;
end $$;

-- On a fresh database, convert old generated economics columns to payout-aware ordinary columns before creating this trigger.
create trigger portfolio_economics_compute before insert or update of total_cost_ars,gross_return_ars,payout_complete on public.portfolio_results for each row execute function internal.compute_portfolio_economics();

create or replace view public.simulation_lab_status with (security_invoker=true) as
select
  (select count(*) from public.simulation_presets where active) as active_presets,
  (select count(*) from public.simulation_experiments) as experiments,
  (select count(*) from public.simulation_experiments where status='COMPLETED') as completed_experiments,
  (select coalesce(sum(requested_iterations),0) from public.simulation_experiments where status='COMPLETED') as completed_iterations,
  (select count(*) from public.simulation_chunks where status='COMPLETED') as completed_chunks,
  (select count(*) from public.shadow_portfolios) as materialized_shadows,
  (select count(*) from public.shadow_evaluations) as shadow_evaluations;

grant select on public.simulation_lab_status to anon, authenticated, service_role;

-- The full internal.evaluate_prospective_draw implementation is mirrored in
-- docs/EVALUATION_SIMULATION_V1.md and must remain EVALUATION_V1-compatible.
