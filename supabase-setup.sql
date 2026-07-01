-- ============================================================================
--  NOLA LABS · TABLERO PORTAFOLIO — Configuración de la nube (Supabase)
--  Referencia: esto YA está aplicado en el proyecto baqevhsyawugvekqbwsm.
--  Úsalo solo si montas el tablero en un proyecto Supabase nuevo.
-- ============================================================================

-- 1) Tabla donde vive el portafolio. Una fila por usuario (owner).
create table if not exists public.portafolios (
  owner       uuid primary key references auth.users (id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 2) Row Level Security: nadie ve filas ajenas.
alter table public.portafolios enable row level security;

drop policy if exists "leer propio portafolio"   on public.portafolios;
drop policy if exists "crear propio portafolio"  on public.portafolios;
drop policy if exists "editar propio portafolio" on public.portafolios;

create policy "leer propio portafolio"
  on public.portafolios for select
  using (auth.uid() = owner);

create policy "crear propio portafolio"
  on public.portafolios for insert
  with check (auth.uid() = owner);

create policy "editar propio portafolio"
  on public.portafolios for update
  using (auth.uid() = owner)
  with check (auth.uid() = owner);

-- 3) Sincronización en vivo entre dispositivos.
alter publication supabase_realtime add table public.portafolios;

-- 4) La Edge Function `quotes` (precios en vivo) se despliega aparte:
--    supabase functions deploy quotes
--    (código en el historial del proyecto; proxy de Yahoo Finance con CORS)
