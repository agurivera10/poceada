create index if not exists portfolio_shadow_comparisons_batch_id_idx
  on public.portfolio_shadow_comparisons(batch_id);

create index if not exists simulation_experiments_preset_slug_idx
  on public.simulation_experiments(preset_slug);
