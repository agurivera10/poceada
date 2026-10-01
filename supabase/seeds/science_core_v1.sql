-- Seed idempotente para SCIENCE CORE V1.
-- Requiere DATA-V1 ya cargado en public.draws/public.draw_numbers.

do $$
declare
  sid uuid;
begin
  select id into sid from public.dataset_snapshots where label = 'DATA-V1 canonical through draw 316' limit 1;

  if sid is null then
    insert into public.dataset_snapshots(label, through_draw_number, manifest)
    values (
      'DATA-V1 canonical through draw 316',
      316,
      jsonb_build_object(
        'version','DATA-V1',
        'first_draw',50,
        'last_draw',316,
        'expected_draws',267,
        'source','public.draws_full',
        'known_open_conflict','draw 101 date'
      )
    ) returning id into sid;

    insert into public.dataset_snapshot_draws(snapshot_id, draw_number, draw_date, validation_status, numbers, row_sha256)
    select sid, d.draw_number, d.draw_date, d.validation_status, d.numbers::smallint[], repeat('0',64)
    from public.draws_full d
    where d.draw_number <= 316
    order by d.draw_number;

    update public.dataset_snapshots set frozen_at = now() where id = sid;
  end if;
end $$;

insert into public.model_versions(slug, name, description, methodology, code_version, model_family, frozen_at)
values
(
  'uniform-baseline-v1',
  'Uniform Baseline V1',
  'Null baseline: each number has marginal probability 0.10 for every draw.',
  jsonb_build_object('probability_per_number',0.10,'probability_sum',10.0,'purpose','scientific null baseline'),
  'SCIENCE_CORE_V1',
  'BASELINE',
  now()
),
(
  'random-ranking-control-v1',
  'Random Ranking Control V1',
  'Seeded random control with uniform 0.10 marginal probabilities and randomized rank order.',
  jsonb_build_object('probability_per_number',0.10,'probability_sum',10.0,'ranking','seeded uniform random permutation','seed_required',true),
  'SCIENCE_CORE_V1',
  'CONTROL',
  now()
)
on conflict (slug) do nothing;
