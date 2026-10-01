update public.simulation_presets
set active=false,
    description=case
      when position('[Bloqueado hasta ECON-V1:' in description)=0
        then description || ' [Bloqueado hasta ECON-V1: requiere payouts oficiales completos y supuestos económicos preregistrados.]'
      else description
    end
where slug='bankroll-risk-v1';
