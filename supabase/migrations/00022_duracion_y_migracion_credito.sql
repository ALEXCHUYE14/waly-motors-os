-- ============================================================
-- WALY MOTORS OS — Migración 00022
--
-- Tres ajustes al flujo de contratos de venta a crédito:
--
--   1) Duración configurable en meses (`duracion_meses`) — nunca un
--      valor fijo en el código: el asesor la escribe por contrato y el
--      sistema calcula `fecha_fin` real (calendario exacto, ver
--      `src/lib/calculo-credito.ts`).
--
--   2) Monto total calculado por tarifa diaria diferenciada
--      (`monto_lunes_sabado`, `monto_domingo`): se guardan las tarifas
--      usadas en el contrato (auditoría/trazabilidad — nunca hardcoded
--      en la base de datos ni en el backend, son parámetros de la RPC),
--      el cálculo real (contar días de calendario) vive en el frontend
--      y llega ya resuelto como `p_monto_total`/`p_fecha_fin`.
--
--   3) Migración de clientes con historial en cuaderno
--      (`pagos_previos_acumulados`): un monto que representa cuotas ya
--      cobradas ANTES de registrar el contrato en el sistema. Se guarda
--      como dato informativo en `contratos` (mismo criterio que ya
--      existía para `cuota_inicial`) Y ADEMÁS se inserta como una fila
--      real en `pagos` (método 'abono_adicional', migración 00021) —
--      así el saldo pendiente, el % de avance y la mora se calculan
--      SOLOS a partir de la suma de `pagos`, sin duplicar esa lógica en
--      `resumen_contrato`, `kpis_dashboard` ni `obtener_clientes_en_mora`.
--
--      El punto fino: esa fila de `pagos` NO se fecha "hoy" (el día en
--      que se está migrando el cliente) ni en `fecha_inicio` del
--      contrato (eso haría pensar al sistema que el cliente solo pagó
--      UN día y ya está en mora). Se fecha en `p_fecha_pagos_previos`
--      — la fecha "al día" que el frontend calcula como
--      `fecha_inicio + meses ya pagados` — para que
--      `obtener_clientes_en_mora` calcule la próxima cuota vencida a
--      partir de ahí, no desde el día 1.
-- ============================================================

alter table public.contratos
  add column duracion_meses           integer check (duracion_meses is null or duracion_meses > 0),
  add column monto_lunes_sabado       numeric(10,2) check (monto_lunes_sabado is null or monto_lunes_sabado > 0),
  add column monto_domingo            numeric(10,2) check (monto_domingo is null or monto_domingo > 0),
  add column pagos_previos_acumulados numeric(12,2) not null default 0
    check (pagos_previos_acumulados >= 0);

create or replace function public.crear_contrato(
  p_cliente_id              uuid,
  p_vehiculo_id             uuid,
  p_tipo                    text,
  p_monto_total             numeric,
  p_cuota_inicial           numeric,
  p_monto_cuota             numeric,
  p_frecuencia_pago         text,
  p_dia_pago_preferido      integer default null,
  p_fecha_inicio            date default current_date,
  p_fecha_fin               date default null,
  p_firma_base64            text default null,
  p_documentos_garantia     text[] default '{}',
  p_duracion_meses          integer default null,
  p_monto_lunes_sabado      numeric default null,
  p_monto_domingo           numeric default null,
  p_pagos_previos_acumulados numeric default 0,
  p_fecha_pagos_previos     timestamptz default null
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
  if coalesce(public.fn_rol_actual(), '') not in ('admin', 'asesor') then
    raise exception 'No autorizado para crear contratos';
  end if;

  if not exists (select 1 from public.clientes where id = p_cliente_id and activo = true) then
    raise exception 'Cliente no encontrado o eliminado';
  end if;

  if coalesce(p_pagos_previos_acumulados, 0) < 0 then
    raise exception 'Los pagos previos acumulados no pueden ser negativos';
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
    firma_base64, firma_fecha, documentos_garantia, creado_por,
    duracion_meses, monto_lunes_sabado, monto_domingo, pagos_previos_acumulados
  ) values (
    p_cliente_id, p_vehiculo_id, p_tipo,
    p_monto_total, p_cuota_inicial, p_monto_cuota,
    p_frecuencia_pago, p_dia_pago_preferido,
    p_fecha_inicio, p_fecha_fin, 'activo',
    p_firma_base64,
    case when p_firma_base64 is not null then now() else null end,
    p_documentos_garantia,
    auth.uid(),
    p_duracion_meses, p_monto_lunes_sabado, p_monto_domingo,
    coalesce(p_pagos_previos_acumulados, 0)
  )
  returning * into v_contrato;

  -- Estado del vehículo según tipo de contrato
  update public.vehiculos
  set estado = case p_tipo
                 when 'alquiler'      then 'alquilado'
                 when 'venta_credito' then 'vendido'
               end
  where id = p_vehiculo_id;

  -- La cuota inicial se registra como primer pago (si existe) — cobro de
  -- HOY, parte de la firma del contrato.
  if p_cuota_inicial > 0 then
    insert into public.pagos (
      contrato_id, monto_recibido, metodo_pago,
      estado, recaudador_id, observaciones
    ) values (
      v_contrato.id, p_cuota_inicial, 'efectivo',
      'completado', auth.uid(), 'Cuota inicial del contrato'
    );
  end if;

  -- Pagos previos migrados del cuaderno (si aplica) — histórico, fechado
  -- a la fecha "al día" que calculó el frontend, NUNCA a hoy ni al día 1
  -- del contrato (ver nota arriba sobre por qué le importa a la mora).
  if coalesce(p_pagos_previos_acumulados, 0) > 0 then
    insert into public.pagos (
      contrato_id, monto_recibido, metodo_pago,
      estado, recaudador_id, observaciones, fecha_pago
    ) values (
      v_contrato.id, p_pagos_previos_acumulados, 'abono_adicional',
      'completado', auth.uid(),
      'Pagos previos migrados del registro en papel',
      coalesce(p_fecha_pagos_previos, now())
    );
  end if;

  return v_contrato;
end;
$$;

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
    'motivo_finalizacion', c.motivo_finalizacion,
    'monto_total',       c.monto_total,
    'cuota_inicial',     c.cuota_inicial,
    'monto_cuota',       c.monto_cuota,
    'frecuencia_pago',   c.frecuencia_pago,
    'fecha_inicio',      c.fecha_inicio,
    'fecha_fin',         c.fecha_fin,
    'duracion_meses',    c.duracion_meses,
    'monto_lunes_sabado', c.monto_lunes_sabado,
    'monto_domingo',     c.monto_domingo,
    'pagos_previos_acumulados', c.pagos_previos_acumulados,
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
