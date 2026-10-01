create table if not exists public.simulation_checkpoints (
  simulation_experiment_id uuid primary key references public.simulation_experiments(id) on delete cascade,
  job_id uuid references public.simulation_jobs(id) on delete set null,
  completed_iterations bigint not null check (completed_iterations >= 0),
  next_chunk_index integer not null check (next_chunk_index >= 0),
  event_counts jsonb not null default '{}'::jsonb,
  ticket_sums jsonb not null default '{}'::jsonb,
  histograms jsonb not null default '{}'::jsonb,
  checkpoint_sha256 text not null check (checkpoint_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

alter table public.simulation_checkpoints enable row level security;
revoke all on public.simulation_checkpoints from public, anon, authenticated;
grant select, insert, update, delete on public.simulation_checkpoints to service_role;

create or replace function public.claim_simulation_job_by_id(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns setof public.simulation_jobs
language plpgsql
set search_path to ''
as $function$
declare
  v_before public.simulation_jobs%rowtype;
  v_job public.simulation_jobs%rowtype;
  v_resumed boolean := false;
begin
  select * into v_before
  from public.simulation_jobs
  where id=p_job_id
  for update;

  if not found or v_before.cancel_requested then return; end if;

  if v_before.status='QUEUED' then
    null;
  elsif v_before.status in ('CLAIMED','RUNNING','CANCELLING')
        and v_before.lease_expires_at is not null
        and v_before.lease_expires_at < now() then
    v_resumed := true;
  elsif v_before.status='STALE' and v_before.error_code='LEASE_EXPIRED' then
    v_resumed := true;
  else
    return;
  end if;

  if v_resumed then
    insert into public.simulation_job_events(job_id,event_type,message,data)
    values(v_before.id,'CHECKPOINT_RECOVERED','Expired worker lease recovered from durable checkpoint',
      jsonb_build_object('previous_worker_id',v_before.worker_id,'progress_iterations',v_before.progress_iterations));
  end if;

  update public.simulation_jobs j
  set status='CLAIMED',
      worker_id=p_worker_id,
      execution_backend=case when j.execution_backend='UNASSIGNED' then 'PYTHON_WORKER' else j.execution_backend end,
      started_at=coalesce(j.started_at,now()),
      completed_at=null,
      heartbeat_at=now(),
      lease_expires_at=now()+make_interval(secs=>greatest(30,least(900,p_lease_seconds))),
      current_phase=case when v_resumed then 'resume_claim' else 'claim' end,
      error_code=null,
      error_message=null,
      updated_at=now()
  where j.id=p_job_id
  returning j.* into v_job;

  update public.simulation_experiments
  set status='RUNNING',completed_at=null
  where id=v_job.simulation_experiment_id;

  update public.simulation_workers
  set status='BUSY',current_job_id=v_job.id,last_seen_at=now()
  where id=p_worker_id;

  insert into public.simulation_job_events(job_id,event_type,message,data)
  values(v_job.id,'CLAIMED',case when v_resumed then 'Job resumed by specific worker' else 'Job claimed by specific worker' end,
    jsonb_build_object('worker_id',p_worker_id,'backend',v_job.execution_backend,'resumed',v_resumed));

  return next v_job;
end
$function$;

create or replace function public.heartbeat_simulation_job(
  p_job_id uuid,
  p_worker_id text,
  p_progress_iterations bigint,
  p_phase text,
  p_lease_seconds integer default 120,
  p_partial_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_job public.simulation_jobs%rowtype;
  v_checkpoint jsonb;
  v_yield boolean := coalesce(p_phase,'')='checkpoint_yield';
begin
  if v_yield then
    update public.simulation_jobs j
    set progress_iterations=least(j.requested_iterations,greatest(j.progress_iterations,coalesce(p_progress_iterations,j.progress_iterations))),
        current_phase='checkpoint_wait',
        status='QUEUED',
        worker_id=null,
        heartbeat_at=now(),
        lease_expires_at=null,
        result_summary=j.result_summary || coalesce(p_partial_summary,'{}'::jsonb),
        dispatch_ref=null,
        dispatched_at=null,
        dispatch_metadata='{}'::jsonb,
        updated_at=now()
    where j.id=p_job_id
      and j.worker_id=p_worker_id
      and j.status in ('CLAIMED','RUNNING','CANCELLING')
      and not j.cancel_requested
    returning j.* into v_job;
  else
    update public.simulation_jobs j
    set progress_iterations=least(j.requested_iterations,greatest(j.progress_iterations,coalesce(p_progress_iterations,j.progress_iterations))),
        current_phase=coalesce(p_phase,j.current_phase),
        status=case when j.cancel_requested then 'CANCELLING' else 'RUNNING' end,
        heartbeat_at=now(),
        lease_expires_at=now()+make_interval(secs=>greatest(30,least(900,p_lease_seconds))),
        result_summary=j.result_summary || coalesce(p_partial_summary,'{}'::jsonb),
        updated_at=now()
    where j.id=p_job_id
      and j.worker_id=p_worker_id
      and j.status in ('CLAIMED','RUNNING','CANCELLING')
    returning j.* into v_job;
  end if;

  if v_job.id is null then raise exception 'job not owned by worker or not running'; end if;

  v_checkpoint := coalesce(p_partial_summary,'{}'::jsonb)->'checkpoint';
  if jsonb_typeof(v_checkpoint)='object'
     and (v_checkpoint->>'checkpoint_sha256') ~ '^[0-9a-f]{64}$' then
    insert into public.simulation_checkpoints(
      simulation_experiment_id,job_id,completed_iterations,next_chunk_index,
      event_counts,ticket_sums,histograms,checkpoint_sha256,updated_at
    ) values (
      v_job.simulation_experiment_id,
      v_job.id,
      greatest(0,coalesce((v_checkpoint->>'completed_iterations')::bigint,0)),
      greatest(0,coalesce((v_checkpoint->>'next_chunk_index')::integer,0)),
      coalesce(v_checkpoint->'event_counts','{}'::jsonb),
      coalesce(v_checkpoint->'ticket_sums','{}'::jsonb),
      coalesce(v_checkpoint->'histograms','{}'::jsonb),
      v_checkpoint->>'checkpoint_sha256',
      now()
    )
    on conflict (simulation_experiment_id) do update
    set job_id=excluded.job_id,
        completed_iterations=excluded.completed_iterations,
        next_chunk_index=excluded.next_chunk_index,
        event_counts=excluded.event_counts,
        ticket_sums=excluded.ticket_sums,
        histograms=excluded.histograms,
        checkpoint_sha256=excluded.checkpoint_sha256,
        updated_at=now();
  end if;

  if v_yield then
    update public.simulation_experiments set status='QUEUED',completed_at=null where id=v_job.simulation_experiment_id;
    update public.simulation_workers set status='ONLINE',current_job_id=null,last_seen_at=now() where id=p_worker_id;
    insert into public.simulation_job_events(job_id,event_type,message,data)
    values(v_job.id,'CHECKPOINT_YIELD','Worker yielded after durable checkpoint',
      jsonb_build_object('worker_id',p_worker_id,'progress_iterations',v_job.progress_iterations));
  else
    update public.simulation_workers set status='BUSY',current_job_id=p_job_id,last_seen_at=now() where id=p_worker_id;
  end if;

  return jsonb_build_object(
    'job_id',v_job.id,
    'status',v_job.status,
    'cancel_requested',v_job.cancel_requested,
    'progress_iterations',v_job.progress_iterations,
    'requested_iterations',v_job.requested_iterations,
    'yielded',v_yield
  );
end
$function$;

create or replace function public.mark_simulation_job_dispatched(
  p_job_id uuid,
  p_backend text,
  p_dispatch_ref text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.simulation_jobs
language plpgsql
set search_path to ''
as $function$
declare v_job public.simulation_jobs%rowtype;
begin
  if p_backend not in ('RENDER_WORKFLOW','PYTHON_WORKER','LOCAL','GITHUB_ACTIONS') then raise exception 'invalid execution backend'; end if;

  update public.simulation_jobs j
  set execution_backend=p_backend,
      dispatch_ref=p_dispatch_ref,
      dispatched_at=now(),
      dispatch_metadata=coalesce(p_metadata,'{}'::jsonb),
      updated_at=now()
  where j.id=p_job_id
    and j.status in ('QUEUED','CLAIMED','RUNNING')
    and not j.cancel_requested
  returning j.* into v_job;

  if v_job.id is null then raise exception 'job cannot be marked dispatched'; end if;

  insert into public.simulation_job_events(job_id,event_type,message,data)
  values(v_job.id,'DISPATCHED','Simulation dispatched',jsonb_build_object('backend',p_backend,'dispatch_ref',p_dispatch_ref));

  return v_job;
end
$function$;
