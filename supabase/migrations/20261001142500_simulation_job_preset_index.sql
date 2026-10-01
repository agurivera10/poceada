create index if not exists simulation_jobs_preset_slug_idx on public.simulation_jobs(preset_slug) where preset_slug is not null;
