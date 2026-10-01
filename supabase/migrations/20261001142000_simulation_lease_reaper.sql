-- Any worker that comes online first reaps expired leases, preventing eternal RUNNING jobs.
create or replace function public.claim_simulation_job(p_worker_id text,p_lease_seconds integer default 120)
returns setof public.simulation_jobs language plpgsql security invoker set search_path='' as $$
declare v_job public.simulation_jobs%rowtype;
begin
  perform public.mark_stale_simulation_jobs();
  with next_job as (
    select id from public.simulation_jobs
    where status='QUEUED' and cancel_requested=false
    order by priority desc,created_at asc
    for update skip locked
    limit 1
  )
  update public.simulation_jobs j
  set status='CLAIMED',worker_id=p_worker_id,started_at=coalesce(j.started_at,now()),heartbeat_at=now(),
      lease_expires_at=now()+make_interval(secs=>greatest(30,least(900,p_lease_seconds))),current_phase='claim',updated_at=now()
  from next_job n where j.id=n.id returning j.* into v_job;
  if v_job.id is null then return; end if;
  update public.simulation_experiments set status='RUNNING' where id=v_job.simulation_experiment_id;
  update public.simulation_workers set status='BUSY',current_job_id=v_job.id,last_seen_at=now() where id=p_worker_id;
  insert into public.simulation_job_events(job_id,event_type,message,data)
  values(v_job.id,'CLAIMED','Job claimed by worker',jsonb_build_object('worker_id',p_worker_id));
  return next v_job;
end $$;
revoke execute on function public.claim_simulation_job(text,integer) from public,anon,authenticated;
grant execute on function public.claim_simulation_job(text,integer) to service_role;
