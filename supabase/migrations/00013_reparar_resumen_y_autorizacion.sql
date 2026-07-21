-- ============================================================
-- WALY MOTORS OS — Migración 00013
--
-- 1) resumen_contrato quedó desincronizado en producción: la tabla
--    `contratos` ya tiene las columnas de la migración 00009 (firma,
--    garantías, PDF, cuota_inicial, monto_cuota, frecuencia_pago,
--    fecha_inicio/fin, etc.), pero la FUNCIÓN todavía devolvía el
--    JSON reducido de la migración 00005. El frontend depende de
--    esos campos para generar el PDF del contrato — sin ellos,
--    "Descargar" y "Enviar por WhatsApp" fallaban con "faltan datos
--    obligatorios". Se vuelve a aplicar la versión completa (idéntica
--    a la de la migración 00009) para que quede sincronizada.
--
-- 2) Bug de seguridad real: `fn_rol_actual()` devolvía NULL cuando
--    quien llama no tiene sesión (o no tiene fila en `perfiles`). Los
--    checks de autorización en las RPC usan patrones como
--    `if fn_rol_actual() <> 'admin'` o `not in ('admin','asesor')` —
--    en SQL, cualquier comparación contra NULL da NULL, y PL/pgSQL
--    trata un NULL en un IF como falso: la excepción de "no
--    autorizado" NUNCA se disparaba para un llamado sin sesión. Se
--    verificó en vivo: `crear_contrato`, `eliminar_cliente` y
--    `finalizar_contrato` se pudieron invocar sin ningún token de
--    usuario y llegaron hasta la lógica de negocio real. Se corrige
--    en la raíz — `fn_rol_actual()` nunca vuelve a devolver NULL, así
--    que TODOS los checks existentes (y los futuros) quedan blindados
--    sin tener que tocarlos uno por uno.
-- ============================================================

create or replace function public.fn_rol_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select rol from public.perfiles where id = auth.uid()), '');
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
