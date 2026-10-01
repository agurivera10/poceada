-- EVALUATION ENGINE V1
-- Makes portfolio economics payout-aware and installs the idempotent prospectivo evaluator.

alter table public.portfolio_results drop column net_return_ars;
alter table public.portfolio_results drop column roi;
alter table public.portfolio_results add column net_return_ars numeric;
alter table public.portfolio_results add column roi numeric;

create or replace function internal.compute_portfolio_economics()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.payout_complete then
    new.net_return_ars := new.gross_return_ars - new.total_cost_ars;
    new.roi := case when new.total_cost_ars=0 then null else new.net_return_ars/new.total_cost_ars end;
  else
    new.net_return_ars := null;
    new.roi := null;
  end if;
  return new;
end $$;

drop trigger if exists portfolio_economics_compute on public.portfolio_results;
create trigger portfolio_economics_compute
before insert or update of total_cost_ars,gross_return_ars,payout_complete
on public.portfolio_results
for each row execute function internal.compute_portfolio_economics();

create or replace function internal.evaluate_prospective_draw(p_draw_number integer)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  v_draw_id bigint;
  v_winners smallint[];
  v_run record;
  v_pred_count integer;
  v_prob_count integer;
  v_metric double precision;
  v_k integer;
  v_hits integer;
  v_batch_id uuid;
  v_portfolio record;
  v_observed double precision;
  v_less integer;
  v_equal integer;
  v_n integer;
  v_mean double precision;
  v_sd double precision;
  v_run_count integer := 0;
  v_portfolio_count integer := 0;
begin
  select d.id, array_agg(dn.number order by dn.position)::smallint[]
    into v_draw_id, v_winners
  from public.draws d
  join public.draw_numbers dn on dn.draw_id=d.id
  where d.draw_number=p_draw_number
  group by d.id;

  if v_draw_id is null or cardinality(v_winners) <> 10 then
    raise exception 'draw % is missing or incomplete', p_draw_number;
  end if;

  if exists (
    select 1
    from public.model_runs r
    left join public.evaluation_protocols ep on ep.experiment_id=r.experiment_id and ep.frozen_at is not null
    where r.target_draw_number=p_draw_number and r.frozen_at is not null and ep.id is null
  ) then
    raise exception 'draw % has frozen runs without a frozen evaluation protocol', p_draw_number;
  end if;

  for v_run in
    select r.id, r.protocol_version
    from public.model_runs r
    where r.target_draw_number=p_draw_number and r.frozen_at is not null
    order by r.id
  loop
    v_run_count := v_run_count + 1;
    select count(*), count(p.probability)
      into v_pred_count, v_prob_count
    from public.model_predictions p where p.run_id=v_run.id;

    if v_prob_count=100 then
      select avg(power(p.probability - case when p.number=any(v_winners) then 1.0 else 0.0 end,2))
        into v_metric
      from public.model_predictions p where p.run_id=v_run.id;
      insert into public.run_metrics(run_id,metric_name,metric_value,details,computed_at)
      values(v_run.id,'brier_score',v_metric,jsonb_build_object('draw_number',p_draw_number,'protocol','EVALUATION_V1'),now())
      on conflict(run_id,metric_name) do update set metric_value=excluded.metric_value,details=excluded.details,computed_at=excluded.computed_at;

      select -avg(
        (case when p.number=any(v_winners) then 1.0 else 0.0 end) * ln(greatest(1e-12,least(1.0-1e-12,p.probability)))
        + (case when p.number=any(v_winners) then 0.0 else 1.0 end) * ln(greatest(1e-12,least(1.0-1e-12,1.0-p.probability)))
      ) into v_metric
      from public.model_predictions p where p.run_id=v_run.id;
      insert into public.run_metrics(run_id,metric_name,metric_value,details,computed_at)
      values(v_run.id,'log_loss',v_metric,jsonb_build_object('draw_number',p_draw_number,'clip',1e-12),now())
      on conflict(run_id,metric_name) do update set metric_value=excluded.metric_value,details=excluded.details,computed_at=excluded.computed_at;

      select coalesce(sum(p.probability) filter(where p.number=any(v_winners)),0)
        into v_metric
      from public.model_predictions p where p.run_id=v_run.id;
      insert into public.run_metrics(run_id,metric_name,metric_value,details,computed_at)
      values(v_run.id,'winner_probability_mass',v_metric,jsonb_build_object('draw_number',p_draw_number),now())
      on conflict(run_id,metric_name) do update set metric_value=excluded.metric_value,details=excluded.details,computed_at=excluded.computed_at;
    end if;

    foreach v_k in array array[10,15,20,25]
    loop
      if v_pred_count >= v_k then
        select count(*)::integer into v_hits
        from public.model_predictions p
        where p.run_id=v_run.id and p.rank<=v_k and p.number=any(v_winners);
        insert into public.run_metrics(run_id,metric_name,metric_value,details,computed_at)
        values(
          v_run.id,
          case when v_k=15 then 'pool15_hits' else 'hits_at_'||v_k::text end,
          v_hits::double precision,
          jsonb_build_object('draw_number',p_draw_number,'k',v_k),
          now()
        )
        on conflict(run_id,metric_name) do update set metric_value=excluded.metric_value,details=excluded.details,computed_at=excluded.computed_at;
      end if;
    end loop;
  end loop;

  insert into public.ticket_evaluations(ticket_id,draw_id,hits,prize_ars,payout_known,evaluated_at)
  select t.id,v_draw_id,h.hits::smallint,coalesce(dp.payout_ars,0),
         case when h.hits<2 then true else dp.draw_id is not null end,
         now()
  from public.tickets t
  join public.portfolios pf on pf.id=t.portfolio_id
  join public.model_runs r on r.id=pf.run_id
  cross join lateral (
    select count(*)::integer as hits
    from public.ticket_numbers tn
    where tn.ticket_id=t.id and tn.number=any(v_winners)
  ) h
  left join public.draw_payouts dp on dp.draw_id=v_draw_id and dp.hits=h.hits
  where r.target_draw_number=p_draw_number and pf.frozen_at is not null
  on conflict(ticket_id,draw_id) do update
    set hits=excluded.hits,prize_ars=excluded.prize_ars,payout_known=excluded.payout_known,evaluated_at=excluded.evaluated_at;

  insert into public.portfolio_results(portfolio_id,draw_id,total_cost_ars,gross_return_ars,net_return_ars,roi,max_hits,tickets_3plus,tickets_4plus,tickets_5,payout_complete,evaluated_at)
  select pf.id,v_draw_id,sum(t.cost_ars),sum(te.prize_ars),
         case when bool_and(te.payout_known) then sum(te.prize_ars)-sum(t.cost_ars) else null end,
         case when bool_and(te.payout_known) and sum(t.cost_ars)>0 then (sum(te.prize_ars)-sum(t.cost_ars))/sum(t.cost_ars) else null end,
         max(te.hits)::smallint,
         count(*) filter(where te.hits>=3)::integer,
         count(*) filter(where te.hits>=4)::integer,
         count(*) filter(where te.hits=5)::integer,
         bool_and(te.payout_known),now()
  from public.portfolios pf
  join public.model_runs r on r.id=pf.run_id
  join public.tickets t on t.portfolio_id=pf.id
  join public.ticket_evaluations te on te.ticket_id=t.id and te.draw_id=v_draw_id
  where r.target_draw_number=p_draw_number and pf.frozen_at is not null
  group by pf.id
  on conflict(portfolio_id,draw_id) do update
    set total_cost_ars=excluded.total_cost_ars,gross_return_ars=excluded.gross_return_ars,net_return_ars=excluded.net_return_ars,
        roi=excluded.roi,max_hits=excluded.max_hits,tickets_3plus=excluded.tickets_3plus,tickets_4plus=excluded.tickets_4plus,
        tickets_5=excluded.tickets_5,payout_complete=excluded.payout_complete,evaluated_at=excluded.evaluated_at;

  get diagnostics v_portfolio_count = row_count;

  select b.id into v_batch_id
  from public.shadow_batches b
  where b.target_draw_number=p_draw_number and b.geometry_template='K6_EDGE_15' and b.frozen_at is not null
  order by b.created_at desc limit 1;

  if v_batch_id is not null then
    insert into public.shadow_evaluations(batch_id,shadow_index,draw_id,pool_hits,max_hits,tickets_3plus,tickets_4plus,tickets_5,gross_return_ars,payout_complete,evaluated_at)
    select sp.batch_id,sp.shadow_index,v_draw_id,
           ph.pool_hits::smallint,
           st.max_hits::smallint,
           st.tickets_3plus::smallint,
           st.tickets_4plus::smallint,
           st.tickets_5::smallint,
           st.gross_return_ars,
           st.payout_complete,
           now()
    from public.shadow_portfolios sp
    cross join lateral (
      select count(*)::integer as pool_hits from unnest(sp.pool_numbers) n where n=any(v_winners)
    ) ph
    cross join lateral (
      select max(th.hits)::integer as max_hits,
             count(*) filter(where th.hits>=3)::integer as tickets_3plus,
             count(*) filter(where th.hits>=4)::integer as tickets_4plus,
             count(*) filter(where th.hits=5)::integer as tickets_5,
             sum(coalesce(dp.payout_ars,0)) as gross_return_ars,
             bool_and(case when th.hits<2 then true else dp.draw_id is not null end) as payout_complete
      from (
        select jt.idx, count(*) filter(where (n.value)::smallint=any(v_winners))::integer as hits
        from jsonb_array_elements(sp.tickets) with ordinality jt(ticket,idx)
        cross join lateral jsonb_array_elements_text(jt.ticket) n(value)
        group by jt.idx
      ) th
      left join public.draw_payouts dp on dp.draw_id=v_draw_id and dp.hits=th.hits
    ) st
    where sp.batch_id=v_batch_id
    on conflict(batch_id,shadow_index,draw_id) do update
      set pool_hits=excluded.pool_hits,max_hits=excluded.max_hits,tickets_3plus=excluded.tickets_3plus,
          tickets_4plus=excluded.tickets_4plus,tickets_5=excluded.tickets_5,gross_return_ars=excluded.gross_return_ars,
          payout_complete=excluded.payout_complete,evaluated_at=excluded.evaluated_at;

    for v_portfolio in
      select pf.id,
             count(distinct tn.number) filter(where tn.number=any(v_winners))::double precision as pool_hits,
             pr.max_hits::double precision as max_hits,
             pr.tickets_4plus::double precision as tickets_4plus
      from public.portfolios pf
      join public.model_runs r on r.id=pf.run_id
      join public.tickets t on t.portfolio_id=pf.id
      join public.ticket_numbers tn on tn.ticket_id=t.id
      join public.portfolio_results pr on pr.portfolio_id=pf.id and pr.draw_id=v_draw_id
      where r.target_draw_number=p_draw_number and pf.strategy='K6_EDGE_15'
      group by pf.id,pr.max_hits,pr.tickets_4plus
    loop
      foreach v_k in array array[1,2,3]
      loop
        if v_k=1 then v_observed:=v_portfolio.pool_hits;
        elsif v_k=2 then v_observed:=v_portfolio.max_hits;
        else v_observed:=v_portfolio.tickets_4plus;
        end if;

        if v_k=1 then
          select count(*) filter(where se.pool_hits<v_observed),count(*) filter(where se.pool_hits=v_observed),count(*),avg(se.pool_hits),stddev_pop(se.pool_hits)
            into v_less,v_equal,v_n,v_mean,v_sd from public.shadow_evaluations se where se.batch_id=v_batch_id and se.draw_id=v_draw_id;
        elsif v_k=2 then
          select count(*) filter(where se.max_hits<v_observed),count(*) filter(where se.max_hits=v_observed),count(*),avg(se.max_hits),stddev_pop(se.max_hits)
            into v_less,v_equal,v_n,v_mean,v_sd from public.shadow_evaluations se where se.batch_id=v_batch_id and se.draw_id=v_draw_id;
        else
          select count(*) filter(where se.tickets_4plus<v_observed),count(*) filter(where se.tickets_4plus=v_observed),count(*),avg(se.tickets_4plus),stddev_pop(se.tickets_4plus)
            into v_less,v_equal,v_n,v_mean,v_sd from public.shadow_evaluations se where se.batch_id=v_batch_id and se.draw_id=v_draw_id;
        end if;

        insert into public.portfolio_shadow_comparisons(portfolio_id,draw_id,batch_id,metric_name,observed_value,control_mean,control_sd,percentile,details,computed_at)
        values(v_portfolio.id,v_draw_id,v_batch_id,
               case v_k when 1 then 'pool15_hits' when 2 then 'max_hits' else 'tickets_4plus' end,
               v_observed,v_mean,v_sd,
               case when v_n>0 then 100.0*(v_less+0.5*v_equal)/v_n else null end,
               jsonb_build_object('n_controls',v_n,'percentile_method','midrank'),now())
        on conflict(portfolio_id,draw_id,batch_id,metric_name) do update
          set observed_value=excluded.observed_value,control_mean=excluded.control_mean,control_sd=excluded.control_sd,
              percentile=excluded.percentile,details=excluded.details,computed_at=excluded.computed_at;
      end loop;
    end loop;
  end if;

  return jsonb_build_object(
    'draw_number',p_draw_number,
    'draw_id',v_draw_id,
    'runs_evaluated',v_run_count,
    'portfolios_evaluated',v_portfolio_count,
    'shadow_batch_id',v_batch_id,
    'shadow_count',case when v_batch_id is null then 0 else (select count(*) from public.shadow_evaluations se where se.batch_id=v_batch_id and se.draw_id=v_draw_id) end
  );
end;
$$;

revoke all on function internal.evaluate_prospective_draw(integer) from public;
grant execute on function internal.evaluate_prospective_draw(integer) to service_role;
