-- ============================================================
-- WALY MOTORS OS — Migración 00025
--
-- La cuota inicial (entregada para la adjudicación/entrega de la moto)
-- venía distorsionando dos métricas que en realidad hablan del avance
-- del PLAN DE CUOTAS periódicas, no del contrato completo:
--
--   1) % de avance del contrato (resumen_contrato, detalle de contrato):
--      una cuota inicial de S/ 1,000 en un contrato de S/ 14,000 hacía
--      arrancar el avance en ~7% el mismo día de la firma, sin que el
--      cliente hubiera pagado ni una sola cuota diaria/periódica todavía.
--   2) "Caja hoy" del Dashboard (kpis_dashboard): mezclaba el efectivo de
--      cuotas iniciales (dinero de adjudicación, cobrado normalmente por
--      Waldir al firmar, no por los cobradores en calle) junto con la
--      recaudación real de cuotas del día — descuadrando la lectura de
--      cuánto cobraron los cobradores hoy en la calle.
--
-- Identificación unívoca del pago de cuota inicial:
--   Hasta ahora la única forma de distinguirlo era el texto exacto en
--   `observaciones` ('Cuota inicial del contrato') — funcional, pero
--   frágil para filtrar (un typo o una traducción futura lo rompería en
--   silencio). Se agrega `pagos.es_cuota_inicial boolean`, marcada por
--   `crear_contrato` en el momento exacto en que inserta esa fila — la
--   única fuente de verdad de ahora en adelante.
--
-- Compatibilidad histórica: los contratos YA REGISTRADOS también tienen
-- su fila de cuota inicial con ese mismo texto exacto en `observaciones`
-- (es el único lugar del código que lo escribe, sin cambios desde que
-- existe la función) — se usa ese texto UNA SOLA VEZ, en esta migración,
-- para marcar retroactivamente esas filas ya existentes con el nuevo
-- flag. No se borra ni se sobrescribe `observaciones`: solo se agrega el
-- flag encima, así que el cambio es reversible y auditable.
--
-- Los pagos previos migrados del cuaderno (`metodo_pago = 'abono_adicional'`,
-- migración 00021) SÍ cuentan como avance del plan de cuotas — representan
-- cuotas periódicas reales que el cliente ya pagó antes de migrarse al
-- sistema, no son un concepto de adjudicación. Solo se excluye la cuota
-- inicial propiamente dicha.
-- ============================================================

alter table public.pagos
  add column es_cuota_inicial boolean not null default false;

update public.pagos
set es_cuota_inicial = true
where observaciones = 'Cuota inicial del contrato';

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
  -- del plan de cuotas y de "Caja hoy".
  if p_cuota_inicial > 0 then
    insert into public.pagos (
      contrato_id, monto_recibido, metodo_pago,
      estado, recaudador_id, observaciones, es_cuota_inicial
    ) values (
      v_contrato.id, p_cuota_inicial, 'efectivo',
      'completado', auth.uid(), 'Cuota inicial del contrato', true
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
    -- % de avance del PLAN DE CUOTAS únicamente: numerador = solo pagos
    -- periódicos/migrados (excluye la fila marcada `es_cuota_inicial`);
    -- denominador = monto financiado del plan (monto_total menos la
    -- cuota inicial, ambos ya guardados en `contratos` — nunca se
    -- recalcula por separado). `coalesce(...,0)` cubre el caso borde de
    -- un plan sin cronograma propio (cuota_inicial = monto_total): en
    -- vez de un NULL/división por cero, se queda en 0% ("aún no hay
    -- plan de cuotas que avanzar") en vez de romper o mostrar basura.
    'pct_avance', coalesce(least(round(
      100.0 * coalesce(p.total_periodico, 0)
      / nullif(c.monto_total - c.cuota_inicial, 0)
    ), 100), 0),
    'num_pagos',         coalesce(p.cantidad, 0),
    'ultimo_pago',       p.ultimo,
    -- Misma fórmula exacta que obtener_clientes_en_mora — nunca se
    -- calcula por separado, para que las dos nunca se desincronicen.
    -- (La mora sigue considerando TODOS los pagos, cuota inicial
    -- incluida, sin cambios respecto a la migración 00023 — esta
    -- migración solo toca el % de avance y "Caja hoy".)
    'proximo_vencimiento', (
      coalesce(p.ultimo::date, c.fecha_inicio)
        + case c.frecuencia_pago
            when 'diario'    then interval '1 day'
            when 'semanal'   then interval '7 days'
            when 'quincenal' then interval '15 days'
            when 'mensual'   then interval '1 month'
          end
    )::date,
    'dias_retraso', greatest((
      current_date - (
        coalesce(p.ultimo::date, c.fecha_inicio)
          + case c.frecuencia_pago
              when 'diario'    then interval '1 day'
              when 'semanal'   then interval '7 days'
              when 'quincenal' then interval '15 days'
              when 'mensual'   then interval '1 month'
            end
      )::date
    )::integer, 0),
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
      -- Solo pagos periódicos/migrados — excluye la cuota inicial. Ver
      -- comentario de `pct_avance` arriba.
      sum(monto_recibido) filter (where not es_cuota_inicial) as total_periodico,
      count(*)            as cantidad,
      max(fecha_pago)     as ultimo
    from public.pagos
    where contrato_id = c.id
      and estado in ('completado', 'parcial')
  ) p on true
  where c.id = p_contrato_id;
$$;

create or replace function public.kpis_dashboard()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    -- "Caja hoy": recaudación real de cuotas cobradas en calle — excluye
    -- la cuota inicial (dinero de adjudicación, no de cobranza diaria).
    'balance_hoy', coalesce((
      select sum(monto_recibido) from public.pagos
      where fecha_pago::date = current_date
        and estado in ('completado', 'parcial')
        and not es_cuota_inicial
    ), 0),
    -- Registro independiente pedido explícitamente: cuotas iniciales
    -- cobradas HOY (adjudicación/entrega), separado de "Caja hoy" — para
    -- no perder ese dato, solo sacarlo de la métrica de cobranza diaria.
    'cuotas_iniciales_hoy', coalesce((
      select sum(monto_recibido) from public.pagos
      where fecha_pago::date = current_date
        and estado in ('completado', 'parcial')
        and es_cuota_inicial
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
