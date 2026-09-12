-- ============================================================
-- WALY MOTORS OS — Migración 00028
--
-- Bug real reportado: la cuota inicial se registraba con
-- `fecha_pago` en su valor por defecto (`now()`, columna `pagos.fecha_pago`
-- — ver 00001) — es decir, el momento en que Waldir/el asesor TIPEA el
-- contrato en el sistema, no la fecha real en que se entregó la moto y
-- se cobró el adelanto. Si la captura de datos se hace días o meses
-- después de la fecha de inicio real del contrato (`fecha_inicio`,
-- elegida a mano en el formulario — puede ser una fecha pasada), la
-- cuota inicial queda fechada muy por delante de esa fecha real.
--
-- Esto rompe DOS cosas a la vez, porque `proximo_vencimiento` (usado
-- tanto por `resumen_contrato` como por `obtener_clientes_en_mora`,
-- migración 00023) se calcula sobre `max(fecha_pago)` de TODOS los
-- pagos del contrato, cuota inicial incluida (a propósito — ver
-- comentario de 00025, la cuota inicial solo se excluye del % de avance
-- y de "Caja hoy", nunca de la mora):
--
--   1) Si ya existían pagos periódicos/abonos reales con fecha anterior
--      a "hoy" (el día en que se tipeó la cuota inicial), esa fecha
--      falsa se vuelve el nuevo `max(fecha_pago)` y ADELANTA
--      `proximo_vencimiento` muy por delante del cronograma real —
--      enmascarando días de mora que sí existen (el caso reportado:
--      último pago periódico real el 2/set, pero la cuota inicial
--      fechada "hoy" hace que el sistema calcule la mora desde una
--      fecha mucho más tardía que la correcta).
--   2) La fecha mostrada en el detalle del contrato para ese primer
--      abono nunca coincide con la "Fecha de inicio" impresa en el PDF
--      del contrato (que sí usa `fecha_inicio` tal cual — ver
--      contrato-pdf.ts) — dos pantallas del mismo contrato mostrando
--      dos fechas distintas para el mismo hecho.
--
-- Corrección: la cuota inicial es conceptualmente el pago que se hace
-- AL INICIO del contrato — su `fecha_pago` debe heredar explícitamente
-- `fecha_inicio`, nunca el instante de captura en el sistema. Mismo
-- criterio de mediodía que ya usa el resto del código (fechaCobertura,
-- fechaPagosPrevios) para que la fecha elegida nunca se corra de día
-- por huso horario al guardarse como timestamptz.
--
-- Caso sin cambio de comportamiento (el más común: el contrato se
-- registra el mismo día en que empieza): si no hay ningún pago
-- posterior, `proximo_vencimiento` ya usaba `coalesce(max(fecha_pago),
-- fecha_inicio)` — anclar la cuota inicial a `fecha_inicio` da
-- exactamente el mismo valor que el `coalesce` ya devolvía sin ella.
-- Solo cambia el caso roto: cuando la captura ocurre después de la
-- fecha de inicio real y ya hay pagos periódicos/abonos de por medio.
--
-- Retrocompatibilidad: se corrige también la fila de cuota inicial de
-- TODOS los contratos ya existentes (`es_cuota_inicial = true`), para
-- que la mora y la fecha mostrada queden consistentes en todo el
-- sistema, no solo en los contratos nuevos de ahora en adelante. No se
-- toca `monto_recibido`, `estado` ni ninguna otra columna — el saldo,
-- el total pagado y el % de avance no dependen de esta fecha (ver
-- 00025), así que ningún monto ya calculado cambia.
-- ============================================================

update public.pagos p
set fecha_pago = (c.fecha_inicio::timestamp + time '12:00:00')
from public.contratos c
where p.contrato_id = c.id
  and p.es_cuota_inicial = true
  and p.fecha_pago::date <> c.fecha_inicio;

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

  -- La cuota inicial se registra como primer pago (si existe) — marcada
  -- con `es_cuota_inicial = true`: es la única fuente de verdad que
  -- `resumen_contrato`/`kpis_dashboard` usan para excluirla del avance
  -- del plan de cuotas y de "Caja hoy". `fecha_pago` se ancla
  -- explícitamente a `fecha_inicio` (mediodía, mismo criterio que el
  -- resto del sistema) — NUNCA al instante en que se registra el
  -- contrato: es la fecha real en que se entregó la moto y se cobró el
  -- adelanto, y es la que participa en el cálculo de mora (ver 00023).
  if p_cuota_inicial > 0 then
    insert into public.pagos (
      contrato_id, monto_recibido, metodo_pago,
      estado, recaudador_id, observaciones, es_cuota_inicial, fecha_pago
    ) values (
      v_contrato.id, p_cuota_inicial, 'efectivo',
      'completado', auth.uid(), 'Cuota inicial del contrato', true,
      (p_fecha_inicio::timestamp + time '12:00:00')
    );
  end if;

  -- Pagos previos migrados del cuaderno (si aplica) — SÍ cuentan como
  -- avance del plan de cuotas (ver nota arriba): `es_cuota_inicial`
  -- queda en su default `false`.
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
