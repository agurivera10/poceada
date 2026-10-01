-- SIM_ENGINE_V2: complete 2/3/4/5 prize-tier semantics.
-- Applied to production on 2026-10-01 before the next large Simulation Lab run.

update public.simulation_presets
set engine_version='SIM_ENGINE_V2',
    default_config = case slug
      when 'portfolio-null-geometry-v1' then jsonb_build_object(
        'chunk_size',100000,
        'exact_when_available',true,
        'event_probabilities',jsonb_build_array(
          'at_least_2','at_least_3','at_least_4','at_least_5',
          'max_exactly_2','max_exactly_3','max_exactly_4','max_exactly_5',
          'multiple_2plus','multiple_3plus','multiple_4plus'
        ),
        'ticket_expectations',jsonb_build_array(
          'exactly_2','exactly_3','exactly_4','exactly_5',
          'at_least_2','at_least_3','at_least_4','at_least_5'
        )
      )
      when 'selection-shadow-v1' then jsonb_build_object(
        'pool_size',15,
        'ticket_count',6,
        'ticket_size',5,
        'geometry','K6_EDGE_15',
        'event_probabilities',jsonb_build_array('at_least_2','at_least_3','at_least_4','at_least_5'),
        'ticket_expectations',jsonb_build_array('exactly_2','exactly_3','exactly_4','exactly_5')
      )
      else default_config
    end
where slug in (
  'portfolio-null-geometry-v1',
  'selection-shadow-v1',
  'null-season-patterns-v1',
  'multiple-testing-redteam-v1'
);
