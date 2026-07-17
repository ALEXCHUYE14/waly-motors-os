-- ============================================================
-- WALY MOTORS OS — Esquema inicial
-- Alquiler y venta de mototaxis · Waldir Yarlequé
-- PostgreSQL 15 / Supabase
-- ============================================================

-- ------------------------------------------------------------
-- 0. EXTENSIONES Y UTILIDADES
-- ------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- Trigger genérico para updated_at
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 1. PERFILES
-- (creada antes de fn_rol_actual: las funciones LANGUAGE SQL se
-- validan contra el catálogo en el momento de CREATE FUNCTION,
-- así que la tabla que consultan debe existir primero)
-- ------------------------------------------------------------
create table public.perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  rol         text not null default 'asesor'
              check (rol in ('admin', 'mecanico', 'asesor')),
  telefono    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_perfiles_updated_at
  before update on public.perfiles
  for each row execute function public.fn_set_updated_at();

-- Rol del usuario autenticado (SECURITY DEFINER para evitar
-- recursión de RLS sobre la propia tabla perfiles)
create or replace function public.fn_rol_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.perfiles where id = auth.uid();
$$;

-- ------------------------------------------------------------
-- 2. VEHÍCULOS
-- ------------------------------------------------------------
create table public.vehiculos (
  id                     uuid primary key default gen_random_uuid(),
  placa                  text not null unique,
  modelo                 text not null,
  anio                   integer not null
                         check (anio between 1990 and extract(year from now())::int + 1),
  numero_chasis          text not null unique,
  estado                 text not null default 'disponible'
                         check (estado in ('disponible', 'alquilado', 'en_mantenimiento', 'vendido')),
  precio_alquiler_diario numeric(10,2) check (precio_alquiler_diario >= 0),
  precio_venta           numeric(10,2) check (precio_venta >= 0),
  kilometraje            integer not null default 0 check (kilometraje >= 0),
  fotos                  text[] not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index idx_vehiculos_placa  on public.vehiculos (placa);
create index idx_vehiculos_estado on public.vehiculos (estado);

create trigger trg_vehiculos_updated_at
  before update on public.vehiculos
  for each row execute function public.fn_set_updated_at();

-- ------------------------------------------------------------
-- 3. CLIENTES
-- ------------------------------------------------------------
create table public.clientes (
  id               uuid primary key default gen_random_uuid(),
  tipo_documento   text not null default 'DNI'
                   check (tipo_documento in ('DNI', 'RUC')),
  numero_documento text not null unique
                   check (
                     (tipo_documento = 'DNI' and numero_documento ~ '^[0-9]{8}$') or
                     (tipo_documento = 'RUC' and numero_documento ~ '^(10|20)[0-9]{9}$')
                   ),
  nombre_completo  text not null,
  telefono         text check (telefono ~ '^\+[0-9]{9,15}$'), -- ej: +51987654321
  direccion        text,
  referencia       text,
  foto_perfil      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_clientes_numero_documento on public.clientes (numero_documento);
create index idx_clientes_nombre_trgm on public.clientes
  using gin (nombre_completo gin_trgm_ops);
-- (requiere: create extension if not exists pg_trgm;)

create trigger trg_clientes_updated_at
  before update on public.clientes
  for each row execute function public.fn_set_updated_at();

-- ------------------------------------------------------------
-- 4. CONTRATOS
-- ------------------------------------------------------------
create table public.contratos (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references public.clientes(id),
  vehiculo_id         uuid not null references public.vehiculos(id),
  tipo                text not null
                      check (tipo in ('alquiler', 'venta_credito')),
  monto_total         numeric(12,2) not null check (monto_total > 0),
  cuota_inicial       numeric(12,2) not null default 0 check (cuota_inicial >= 0),
  monto_cuota         numeric(10,2) not null check (monto_cuota > 0),
  frecuencia_pago     text not null default 'diario'
                      check (frecuencia_pago in ('diario', 'semanal', 'quincenal', 'mensual')),
  dia_pago_preferido  integer check (dia_pago_preferido between 1 and 31),
  fecha_inicio        date not null,
  fecha_fin           date check (fecha_fin > fecha_inicio),
  estado              text not null default 'activo'
                      check (estado in ('activo', 'vencido', 'finalizado')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_contratos_cliente  on public.contratos (cliente_id);
create index idx_contratos_vehiculo on public.contratos (vehiculo_id);
create index idx_contratos_estado   on public.contratos (estado) where estado = 'activo';

create trigger trg_contratos_updated_at
  before update on public.contratos
  for each row execute function public.fn_set_updated_at();

-- ------------------------------------------------------------
-- 5. PAGOS
-- ------------------------------------------------------------
create table public.pagos (
  id             uuid primary key default gen_random_uuid(),
  contrato_id    uuid not null references public.contratos(id),
  monto_recibido numeric(10,2) not null check (monto_recibido > 0),
  fecha_pago     timestamptz not null default now(),
  metodo_pago    text not null
                 check (metodo_pago in ('efectivo', 'yape', 'plin', 'transferencia')),
  estado         text not null default 'completado'
                 check (estado in ('completado', 'parcial', 'rechazado')),
  recaudador_id  uuid not null references public.perfiles(id),
  evidencia_url  text,
  observaciones  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_pagos_fecha_pago on public.pagos (fecha_pago desc);
create index idx_pagos_contrato   on public.pagos (contrato_id);

create trigger trg_pagos_updated_at
  before update on public.pagos
  for each row execute function public.fn_set_updated_at();

-- ------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- Lectura: cualquier empleado autenticado.
-- Escritura: solo admin y asesor.
-- ------------------------------------------------------------
alter table public.perfiles  enable row level security;
alter table public.vehiculos enable row level security;
alter table public.clientes  enable row level security;
alter table public.contratos enable row level security;
alter table public.pagos     enable row level security;

-- PERFILES: cada quien ve todos, edita solo el suyo; admin edita todos
create policy "perfiles_select" on public.perfiles
  for select to authenticated using (true);

-- Un usuario no-admin puede editar su propio perfil, pero no su propio
-- rol (evita que se auto-asigne 'admin'). Solo un admin cambia roles.
create policy "perfiles_update_propio" on public.perfiles
  for update to authenticated
  using (id = auth.uid() or public.fn_rol_actual() = 'admin')
  with check (
    public.fn_rol_actual() = 'admin'
    or (id = auth.uid() and rol = (select p.rol from public.perfiles p where p.id = auth.uid()))
  );

-- Autoregistro: solo puede crear su propio perfil con el rol más bajo
-- ('asesor'). Asignar 'admin' o 'mecanico' de entrada requiere ser admin.
create policy "perfiles_insert_admin" on public.perfiles
  for insert to authenticated
  with check (
    public.fn_rol_actual() = 'admin'
    or (id = auth.uid() and rol = 'asesor')
  );

-- VEHÍCULOS / CLIENTES / CONTRATOS / PAGOS
do $$
declare t text;
begin
  foreach t in array array['vehiculos','clientes','contratos','pagos'] loop
    execute format($p$
      create policy "%1$s_select_empleados" on public.%1$s
        for select to authenticated using (true);
    $p$, t);
    execute format($p$
      create policy "%1$s_insert_gestion" on public.%1$s
        for insert to authenticated
        with check (public.fn_rol_actual() in ('admin','asesor'));
    $p$, t);
    execute format($p$
      create policy "%1$s_update_gestion" on public.%1$s
        for update to authenticated
        using (public.fn_rol_actual() in ('admin','asesor'))
        with check (public.fn_rol_actual() in ('admin','asesor'));
    $p$, t);
    execute format($p$
      create policy "%1$s_delete_admin" on public.%1$s
        for delete to authenticated
        using (public.fn_rol_actual() = 'admin');
    $p$, t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 7. RPC ATÓMICA: registrar_pago
-- Bloqueo pesimista sobre el contrato para evitar dobles cobros
-- concurrentes desde varios recaudadores en calle.
-- ------------------------------------------------------------
create or replace function public.registrar_pago(
  p_contrato_id   uuid,
  p_monto         numeric,
  p_metodo        text,
  p_evidencia_url text default null,
  p_observaciones text default null
)
returns public.pagos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contrato public.contratos%rowtype;
  v_pago     public.pagos%rowtype;
begin
  if public.fn_rol_actual() not in ('admin', 'asesor') then
    raise exception 'No autorizado para registrar pagos';
  end if;

  select * into v_contrato
  from public.contratos
  where id = p_contrato_id
  for update;                      -- 🔒 bloqueo pesimista

  if not found then
    raise exception 'Contrato no encontrado';
  end if;

  if v_contrato.estado <> 'activo' then
    raise exception 'El contrato no está activo (estado: %)', v_contrato.estado;
  end if;

  insert into public.pagos (
    contrato_id, monto_recibido, metodo_pago,
    estado, recaudador_id, evidencia_url, observaciones
  ) values (
    p_contrato_id,
    p_monto,
    p_metodo,
    case when p_monto >= v_contrato.monto_cuota then 'completado' else 'parcial' end,
    auth.uid(),
    p_evidencia_url,
    p_observaciones
  )
  returning * into v_pago;

  return v_pago;
end;
$$;

-- ------------------------------------------------------------
-- 8. RPC: obtener_clientes_en_mora
-- Calcula días de atraso según frecuencia de pago del contrato
-- y el último pago completado. Alimenta la sección
-- "Acción Urgente" del Dashboard.
-- ------------------------------------------------------------
create or replace function public.obtener_clientes_en_mora()
returns table (
  contrato_id     uuid,
  cliente_id      uuid,
  nombre_completo text,
  telefono        text,
  foto_perfil     text,
  placa           text,
  monto_cuota     numeric,
  fecha_vencida   date,
  dias_retraso    integer
)
language sql
stable
security definer
set search_path = public
as $$
  with ultimo_pago as (
    select p.contrato_id, max(p.fecha_pago)::date as ultima_fecha
    from public.pagos p
    where p.estado = 'completado'
    group by p.contrato_id
  ),
  base as (
    select
      c.id as contrato_id,
      cl.id as cliente_id,
      cl.nombre_completo,
      cl.telefono,
      cl.foto_perfil,
      v.placa,
      c.monto_cuota,
      coalesce(up.ultima_fecha, c.fecha_inicio)
        + case c.frecuencia_pago
            when 'diario'    then interval '1 day'
            when 'semanal'   then interval '7 days'
            when 'quincenal' then interval '15 days'
            when 'mensual'   then interval '1 month'
          end as proximo_vencimiento
    from public.contratos c
    join public.clientes  cl on cl.id = c.cliente_id
    join public.vehiculos v  on v.id  = c.vehiculo_id
    left join ultimo_pago up on up.contrato_id = c.id
    where c.estado = 'activo'
  )
  select
    contrato_id,
    cliente_id,
    nombre_completo,
    telefono,
    foto_perfil,
    placa,
    monto_cuota,
    proximo_vencimiento::date as fecha_vencida,
    (current_date - proximo_vencimiento::date)::integer as dias_retraso
  from base
  where proximo_vencimiento::date < current_date
  order by dias_retraso desc;
$$;

-- ------------------------------------------------------------
-- 9. RPC: kpis_dashboard — balance del día, flota activa, mora
-- ------------------------------------------------------------
create or replace function public.kpis_dashboard()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'balance_hoy', coalesce((
      select sum(monto_recibido) from public.pagos
      where fecha_pago::date = current_date
        and estado in ('completado', 'parcial')
    ), 0),
    'pct_flota_activa', coalesce((
      select round(
        100.0 * count(*) filter (where estado = 'alquilado')
        / nullif(count(*) filter (where estado <> 'vendido'), 0)
      ) from public.vehiculos
    ), 0),
    'clientes_en_mora', (
      select count(*) from public.obtener_clientes_en_mora()
    )
  );
$$;

-- ------------------------------------------------------------
-- NOTA: ejecutar antes de la migración si no existe:
--   create extension if not exists pg_trgm;
-- Storage: crear buckets 'vehiculos', 'clientes' y 'evidencias'
-- con políticas de lectura authenticated / escritura admin+asesor.
-- ------------------------------------------------------------
