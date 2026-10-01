-- Keep experiment/worker/event state consistent when a worker lease expires.
create or replace function public.mark_stale_simulation_jobs()
returns integer
language plpgsql
security invoker
set search_path=''
as $$
declare
  v record;
  v_count integer := 0;
begin
  for v in
    update public.simulation_jobs j
       set status='STALE',
           completed_at=now(),
           current_phase='stale',
           error_code='LEASE_EXPIRED',
           error_message='Worker heartbeat lease expired',
           lease_expires_at=null,
           updated_at=now()
     where j.status in ('CLAIMED','RUNNING','CANCELLING')
       and j.lease_expires_at < now()
     returning j.id,j.simulation_experiment_id,j.worker_id
  loop
    v_count := v_count + 1;
    update public.simulation_experiments
       set status='FAILED',completed_at=now()
     where id=v.simulation_experiment_id;
    update public.simulation_workers
       set status='OFFLINE',current_job_id=null,last_seen_at=now()
     where id=v.worker_id;
    insert into public.simulation_job_events(job_id,event_type,message,data)
    values(v.id,'STALE','Worker heartbeat lease expired',jsonb_build_object('worker_id',v.worker_id));
  end loop;
  return v_count;
end $$;

revoke execute on function public.mark_stale_simulation_jobs() from public,anon,authenticated;
grant execute on function public.mark_stale_simulation_jobs() to service_role;
