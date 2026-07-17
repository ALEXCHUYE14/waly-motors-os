-- ============================================================
-- WALY MOTORS OS — Migración 00006
-- Historial de mantenimiento por vehículo + alertas de servicio
-- por kilometraje o por fecha.
-- ============================================================

create table public.mantenimientos (
  id                    uuid primary key default gen_random_uuid(),
  vehiculo_id           uuid not null references public.vehiculos(id),
  tipo                  text not null
                        check (tipo in ('preventivo', 'correctivo', 'llantas', 'motor', 'otro')),
  descripcion           text,
  costo                 numeric(10,2) check (costo >= 0),
  kilometraje_servicio  integer not null check (kilometraje_servicio >= 0),
  fecha_servicio        date not null default current_date,
  proximo_km            integer check (proximo_km >= 0),
  proximo_fecha         date,
  realizado_por         uuid not null references public.perfiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_mantenimientos_vehiculo on public.mantenimientos (vehiculo_id, fecha_servicio desc);

create trigger trg_mantenimientos_updated_at
  before update on public.mantenimientos
  for each row execute function public.fn_set_updated_at();

alter table public.mantenimientos enable row level security;

create policy "mantenimientos_select_empleados" on public.mantenimientos
  for select to authenticated using (true);

create policy "mantenimientos_insert_gestion" on public.mantenimientos
  for insert to authenticated
  with check (public.fn_rol_actual() in ('admin', 'asesor', 'mecanico'));

create policy "mantenimientos_update_gestion" on public.mantenimientos
  for update to authenticated
  using (public.fn_rol_actual() in ('admin', 'asesor', 'mecanico'))
  with check (public.fn_rol_actual() in ('admin', 'asesor', 'mecanico'));

create policy "mantenimientos_delete_admin" on public.mantenimientos
  for delete to authenticated
  using (public.fn_rol_actual() = 'admin');

-- ------------------------------------------------------------
-- RPC ATÓMICA: registrar_mantenimiento
-- Inserta el registro de servicio y, si el kilometraje informado
-- es mayor al actual del vehículo, actualiza el odómetro (misma
-- lectura tomada en el taller es la fuente de verdad más reciente).
-- ------------------------------------------------------------
create or replace function public.registrar_mantenimiento(
  p_vehiculo_id          uuid,
  p_tipo                 text,
  p_descripcion          text default null,
  p_costo                numeric default null,
  p_kilometraje_servicio integer default 0,
  p_fecha_servicio       date default current_date,
  p_proximo_km           integer default null,
  p_proximo_fecha        date default null
)
returns public.mantenimientos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mantenimiento public.mantenimientos%rowtype;
begin
  if public.fn_rol_actual() not in ('admin', 'asesor', 'mecanico') then
    raise exception 'No autorizado para registrar mantenimiento';
  end if;

  if not exists (select 1 from public.vehiculos where id = p_vehiculo_id) then
    raise exception 'Vehículo no encontrado';
  end if;

  insert into public.mantenimientos (
    vehiculo_id, tipo, descripcion, costo,
    kilometraje_servicio, fecha_servicio,
    proximo_km, proximo_fecha, realizado_por
  ) values (
    p_vehiculo_id, p_tipo, p_descripcion, p_costo,
    p_kilometraje_servicio, p_fecha_servicio,
    p_proximo_km, p_proximo_fecha, auth.uid()
  )
  returning * into v_mantenimiento;

  update public.vehiculos
  set kilometraje = p_kilometraje_servicio
  where id = p_vehiculo_id
    and p_kilometraje_servicio > kilometraje;

  return v_mantenimiento;
end;
$$;

-- ------------------------------------------------------------
-- RPC: vehiculos_alerta_mantenimiento
-- Un vehículo entra en alerta si, según su ÚLTIMO servicio, ya
-- alcanzó o superó el kilometraje/fecha de próximo mantenimiento.
-- Vehículos sin historial no generan alerta (nada que comparar).
-- ------------------------------------------------------------
create or replace function public.vehiculos_alerta_mantenimiento()
returns table (
  vehiculo_id uuid,
  placa       text,
  motivo      text
)
language sql
stable
security definer
set search_path = public
as $$
  with ultimo as (
    select distinct on (m.vehiculo_id)
      m.vehiculo_id, m.proximo_km, m.proximo_fecha
    from public.mantenimientos m
    order by m.vehiculo_id, m.fecha_servicio desc, m.created_at desc
  )
  select
    v.id,
    v.placa,
    case
      when u.proximo_km is not null and v.kilometraje >= u.proximo_km then 'km'
      else 'fecha'
    end
  from public.vehiculos v
  join ultimo u on u.vehiculo_id = v.id
  where v.estado <> 'vendido'
    and (
      (u.proximo_km is not null and v.kilometraje >= u.proximo_km)
      or (u.proximo_fecha is not null and u.proximo_fecha <= current_date)
    );
$$;

-- kpis_dashboard: agrega el conteo de vehículos en alerta de mantenimiento.
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
    ),
    'vehiculos_en_alerta_mantenimiento', (
      select count(*) from public.vehiculos_alerta_mantenimiento()
    )
  );
$$;
