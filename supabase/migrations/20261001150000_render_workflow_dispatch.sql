alter table public.simulation_jobs add column if not exists execution_backend text not null default 'UNASSIGNED';
alter table public.simulation_jobs add column if not exists dispatch_ref text;
alter table public.simulation_jobs add column if not exists dispatched_at timestamptz;
alter table public.simulation_jobs add column if not exists dispatch_metadata jsonb not null default '{}'::jsonb;
alter table public.simulation_jobs drop constraint if exists simulation_jobs_execution_backend_check;
alter table public.simulation_jobs add constraint simulation_jobs_execution_backend_check check (execution_backend in ('UNASSIGNED','PYTHON_WORKER','RENDER_WORKFLOW','LOCAL','GITHUB_ACTIONS'));
alter table public.simulation_jobs drop constraint if exists simulation_jobs_dispatch_metadata_check;
alter table public.simulation_jobs add constraint simulation_jobs_dispatch_metadata_check check (jsonb_typeof(dispatch_metadata)='object');
create index if not exists simulation_jobs_dispatch_ref_idx on public.simulation_jobs(dispatch_ref) where dispatch_ref is not null;

create or replace function public.mark_simulation_job_dispatched(p_job_id uuid,p_backend text,p_dispatch_ref text,p_metadata jsonb default '{}'::jsonb)
returns public.simulation_jobs language plpgsql security invoker set search_path='' as $$
declare v_job public.simulation_jobs%rowtype;
begin
  if p_backend not in ('RENDER_WORKFLOW','PYTHON_WORKER','LOCAL','GITHUB_ACTIONS') then raise exception 'invalid execution backend'; end if;
  update public.simulation_jobs j
     set execution_backend=p_backend,dispatch_ref=p_dispatch_ref,dispatched_at=now(),dispatch_metadata=coalesce(p_metadata,'{}'::jsonb),updated_at=now()
   where j.id=p_job_id and j.status='QUEUED' and not j.cancel_requested
   returning j.* into v_job;
  if v_job.id is null then raise exception 'job cannot be marked dispatched'; end if;
  insert into public.simulation_job_events(job_id,event_type,message,data)
  values(v_job.id,'DISPATCHED','Simulation dispatched',jsonb_build_object('backend',p_backend,'dispatch_ref',p_dispatch_ref));
  return v_job;
end $$;

create or replace function public.claim_simulation_job_by_id(p_job_id uuid,p_worker_id text,p_lease_seconds integer default 300)
returns setof public.simulation_jobs language plpgsql security invoker set search_path='' as $$
declare v_job public.simulation_jobs%rowtype;
begin
  perform public.mark_stale_simulation_jobs();
  update public.simulation_jobs j
     set status='CLAIMED',worker_id=p_worker_id,
         execution_backend=case when j.execution_backend='UNASSIGNED' then 'PYTHON_WORKER' else j.execution_backend end,
         started_at=coalesce(j.started_at,now()),heartbeat_at=now(),
         lease_expires_at=now()+make_interval(secs=>greatest(30,least(900,p_lease_seconds))),
         current_phase='claim',updated_at=now()
   where j.id=p_job_id and j.status='QUEUED' and not j.cancel_requested
   returning j.* into v_job;
  if v_job.id is null then return; end if;
  update public.simulation_experiments set status='RUNNING' where id=v_job.simulation_experiment_id;
  update public.simulation_workers set status='BUSY',current_job_id=v_job.id,last_seen_at=now() where id=p_worker_id;
  insert into public.simulation_job_events(job_id,event_type,message,data)
  values(v_job.id,'CLAIMED','Job claimed by specific worker',jsonb_build_object('worker_id',p_worker_id,'backend',v_job.execution_backend));
  return next v_job;
end $$;

revoke execute on function public.mark_simulation_job_dispatched(uuid,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.claim_simulation_job_by_id(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.mark_simulation_job_dispatched(uuid,text,text,jsonb) to service_role;
grant execute on function public.claim_simulation_job_by_id(uuid,text,integer) to service_role;
