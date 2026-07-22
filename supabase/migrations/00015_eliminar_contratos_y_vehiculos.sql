-- ============================================================
-- WALY MOTORS OS — Migración 00015
-- Limpieza de datos: permite eliminar contratos ya finalizados y
-- vehículos que no forman parte de ningún contrato (vendidos por
-- error, de prueba, etc.) para mantener el sistema ordenado.
--
-- A diferencia de `eliminar_cliente` (soft delete), estas SÍ borran
-- filas de verdad — por eso se restringen deliberadamente a los únicos
-- casos sin riesgo financiero/legal:
--   · eliminar_contrato: solo contratos YA FINALIZADOS. Nunca se puede
--     borrar un contrato activo o vencido (representa dinero pendiente
--     de cobro).
--   · eliminar_vehiculo: solo vehículos SIN NINGÚN contrato asociado,
--     ni activo ni finalizado. Si el vehículo tiene historial de
--     contratos, hay que eliminar esos contratos primero (si ya están
--     finalizados) antes de poder eliminar el vehículo.
--
-- Ambas son solo para admin y devuelven las rutas de Storage (fotos,
-- PDFs, comprobantes) para que el cliente las borre también —
-- Postgres no puede borrar objetos de Storage directamente.
-- ============================================================

create or replace function public.eliminar_contrato(p_contrato_id uuid)
returns table (
  fotos_evidencia    text[],
  documentos_garantia text[],
  contrato_pdf_url   text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contrato   public.contratos%rowtype;
  v_evidencias text[];
begin
  if coalesce(public.fn_rol_actual(), '') <> 'admin' then
    raise exception 'Solo un administrador puede eliminar contratos';
  end if;

  select * into v_contrato
  from public.contratos
  where id = p_contrato_id
  for update;

  if not found then
    raise exception 'Contrato no encontrado';
  end if;

  if v_contrato.estado <> 'finalizado' then
    raise exception 'Solo se pueden eliminar contratos ya finalizados';
  end if;

  select array_agg(pg.evidencia_url) filter (where pg.evidencia_url is not null)
    into v_evidencias
  from public.pagos pg
  where pg.contrato_id = p_contrato_id;

  delete from public.pagos where contrato_id = p_contrato_id;
  delete from public.contratos where id = p_contrato_id;

  return query select
    coalesce(v_evidencias, '{}'::text[]),
    v_contrato.documentos_garantia,
    v_contrato.contrato_pdf_url;
end;
$$;

create or replace function public.eliminar_vehiculo(p_vehiculo_id uuid)
returns table (fotos text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehiculo public.vehiculos%rowtype;
begin
  if coalesce(public.fn_rol_actual(), '') <> 'admin' then
    raise exception 'Solo un administrador puede eliminar vehículos';
  end if;

  select * into v_vehiculo
  from public.vehiculos
  where id = p_vehiculo_id
  for update;

  if not found then
    raise exception 'Vehículo no encontrado';
  end if;

  if exists (select 1 from public.contratos where vehiculo_id = p_vehiculo_id) then
    raise exception 'No se puede eliminar: el vehículo tiene contratos asociados. Elimina primero esos contratos (si ya están finalizados)';
  end if;

  -- El movimiento de repuestos es un registro contable de stock que
  -- nunca debe perderse — solo se desvincula del mantenimiento que se
  -- va a borrar (queda con `mantenimiento_id = null`), no se elimina.
  update public.movimientos_repuestos
  set mantenimiento_id = null
  where mantenimiento_id in (
    select id from public.mantenimientos where vehiculo_id = p_vehiculo_id
  );

  delete from public.mantenimientos where vehiculo_id = p_vehiculo_id;
  delete from public.vehiculos where id = p_vehiculo_id;

  return query select v_vehiculo.fotos;
end;
$$;
