-- ============================================================
-- WALY MOTORS OS — Migración 00009
-- Firma digital + documentos de garantía + contrato en PDF:
--   · contratos: nuevas columnas para firma, garantías, PDF
--     generado y quién registró el contrato.
--   · Buckets privados nuevos: `contratos` (PDF generado por el
--     sistema) y `garantias` (fotos/PDF subidos por el asesor).
--   · crear_contrato: acepta firma y documentos de garantía.
--   · resumen_contrato: agrega los campos que necesita el
--     generador de PDF (chasis, año, dirección/tipo de doc del
--     cliente, firma y ruta del PDF ya generado).
-- ============================================================

alter table public.contratos
  add column firma_base64      text,
  add column firma_fecha       timestamptz,
  add column documentos_garantia text[] not null default '{}',
  add column contrato_pdf_url  text,
  add column creado_por        uuid references public.perfiles(id);

-- ------------------------------------------------------------
-- Buckets privados nuevos
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('contratos', 'contratos', false, 10485760, array['application/pdf']),
  ('garantias', 'garantias', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "storage_select_empleados_contratos"
  on storage.objects for select to authenticated
  using (bucket_id in ('contratos', 'garantias'));

create policy "storage_insert_gestion_contratos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('contratos', 'garantias')
    and public.fn_rol_actual() in ('admin', 'asesor')
  );

create policy "storage_update_gestion_contratos"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('contratos', 'garantias')
    and public.fn_rol_actual() in ('admin', 'asesor')
  );

create policy "storage_delete_admin_contratos"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('contratos', 'garantias')
    and public.fn_rol_actual() = 'admin'
  );

-- ------------------------------------------------------------
-- crear_contrato: agrega firma y documentos de garantía
-- (parámetros nuevos al final, con default, para no romper
-- llamadas posicionales existentes).
-- ------------------------------------------------------------
create or replace function public.crear_contrato(
  p_cliente_id         uuid,
  p_vehiculo_id        uuid,
  p_tipo               text,
  p_monto_total        numeric,
  p_cuota_inicial      numeric,
  p_monto_cuota        numeric,
  p_frecuencia_pago    text,
  p_dia_pago_preferido integer default null,
  p_fecha_inicio       date default current_date,
  p_fecha_fin          date default null,
  p_firma_base64       text default null,
  p_documentos_garantia text[] default '{}'
)
returns public.contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehiculo public.vehiculos%rowtype;
  v_contrato public.contratos%rowtype;
begin
  if public.fn_rol_actual() not in ('admin', 'asesor') then
    raise exception 'No autorizado para crear contratos';
  end if;

  -- 🔒 Bloqueo pesimista del vehículo
  select * into v_vehiculo
  from public.vehiculos
  where id = p_vehiculo_id
  for update;

  if not found then
    raise exception 'Vehículo no encontrado';
  end if;

  if v_vehiculo.estado <> 'disponible' then
    raise exception 'El vehículo % no está disponible (estado: %)',
      v_vehiculo.placa, v_vehiculo.estado;
  end if;

  -- Un cliente no puede tener dos contratos activos sobre el mismo vehículo
  if exists (
    select 1 from public.contratos
    where vehiculo_id = p_vehiculo_id and estado = 'activo'
  ) then
    raise exception 'El vehículo % ya tiene un contrato activo', v_vehiculo.placa;
  end if;

  insert into public.contratos (
    cliente_id, vehiculo_id, tipo,
    monto_total, cuota_inicial, monto_cuota,
    frecuencia_pago, dia_pago_preferido,
    fecha_inicio, fecha_fin, estado,
    firma_base64, firma_fecha, documentos_garantia, creado_por
  ) values (
    p_cliente_id, p_vehiculo_id, p_tipo,
    p_monto_total, p_cuota_inicial, p_monto_cuota,
    p_frecuencia_pago, p_dia_pago_preferido,
    p_fecha_inicio, p_fecha_fin, 'activo',
    p_firma_base64,
    case when p_firma_base64 is not null then now() else null end,
    p_documentos_garantia,
    auth.uid()
  )
  returning * into v_contrato;

  -- Estado del vehículo según tipo de contrato
  update public.vehiculos
  set estado = case p_tipo
                 when 'alquiler'      then 'alquilado'
                 when 'venta_credito' then 'vendido'
               end
  where id = p_vehiculo_id;

  -- La cuota inicial se registra como primer pago (si existe)
  if p_cuota_inicial > 0 then
    insert into public.pagos (
      contrato_id, monto_recibido, metodo_pago,
      estado, recaudador_id, observaciones
    ) values (
      v_contrato.id, p_cuota_inicial, 'efectivo',
      'completado', auth.uid(), 'Cuota inicial del contrato'
    );
  end if;

  return v_contrato;
end;
$$;

-- ------------------------------------------------------------
-- resumen_contrato: agrega los campos que necesita el generador
-- de PDF de contrato (además de los ya usados por el comprobante
-- de pago, migración 00005).
-- ------------------------------------------------------------
create or replace function public.resumen_contrato(p_contrato_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'contrato_id',       c.id,
    'tipo',              c.tipo,
    'estado',            c.estado,
    'monto_total',       c.monto_total,
    'cuota_inicial',     c.cuota_inicial,
    'monto_cuota',       c.monto_cuota,
    'frecuencia_pago',   c.frecuencia_pago,
    'fecha_inicio',      c.fecha_inicio,
    'fecha_fin',         c.fecha_fin,
    'total_pagado',      coalesce(p.total, 0),
    'saldo',             greatest(c.monto_total - coalesce(p.total, 0), 0),
    'pct_avance',        least(round(100.0 * coalesce(p.total, 0) / nullif(c.monto_total, 0)), 100),
    'num_pagos',         coalesce(p.cantidad, 0),
    'ultimo_pago',       p.ultimo,
    'cliente_nombre',    cl.nombre_completo,
    'cliente_documento', cl.numero_documento,
    'cliente_tipo_documento', cl.tipo_documento,
    'cliente_direccion', cl.direccion,
    'cliente_telefono',  cl.telefono,
    'vehiculo_placa',    v.placa,
    'vehiculo_modelo',   v.modelo,
    'vehiculo_anio',     v.anio,
    'vehiculo_chasis',   v.numero_chasis,
    'vehiculo_km',       v.kilometraje,
    'firma_base64',      c.firma_base64,
    'firma_fecha',       c.firma_fecha,
    'documentos_garantia', c.documentos_garantia,
    'contrato_pdf_url',  c.contrato_pdf_url,
    'creado_en',         c.created_at
  )
  from public.contratos c
  join public.clientes  cl on cl.id = c.cliente_id
  join public.vehiculos v  on v.id  = c.vehiculo_id
  left join lateral (
    select
      sum(monto_recibido) as total,
      count(*)            as cantidad,
      max(fecha_pago)     as ultimo
    from public.pagos
    where contrato_id = c.id
      and estado in ('completado', 'parcial')
  ) p on true
  where c.id = p_contrato_id;
$$;
