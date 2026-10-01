create table if not exists public.simulation_api_tokens (
  token_id text primary key,
  role text not null check (role in ('APP','WORKER')),
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table public.simulation_api_tokens enable row level security;
revoke all on table public.simulation_api_tokens from public, anon, authenticated;
grant select,insert,update,delete on table public.simulation_api_tokens to service_role;

comment on table public.simulation_api_tokens is
  'Hashed narrow-scope credentials for Simulation Gateway. Live token hashes are operational secrets and are intentionally not committed in migrations.';
