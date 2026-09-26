-- ============================================================
-- WALY MOTORS OS — Migración 00031
--
-- Pedido real: un cobro se registró por error (placa equivocada, fecha
-- mal marcada, cobro duplicado) y "corregir el monto" (`editar_monto_pago`,
-- migración 00027) no alcanza — la fila entera no debió existir. Nueva
-- RPC `eliminar_pago`: borra un pago ya registrado, con el mismo
-- criterio de seguridad y concurrencia que `registrar_pago` /
-- `editar_monto_pago`:
--   • Solo admin/asesor (`fn_rol_actual`).
--   • Bloqueo pesimista del pago y del contrato dueño (evita que el
--     borrado se cruce con un cobro nuevo concurrente sobre el mismo
--     contrato).
-- Devuelve la fila borrada completa (incluye `evidencia_url`) para que
-- el frontend pueda limpiar, best-effort, la foto del comprobante en
-- Storage si tenía una — mismo patrón que `eliminar_contrato`.
--
-- Por qué esto también corrige solo la mora que se ve mal en el
-- calendario, sin tocar ninguna función de cálculo: `proximo_vencimiento`
-- siempre se calcula como `max(fecha_pago)` de los pagos que SIGUEN
-- existiendo (ver 00023/00025) — nunca se guarda aparte. Si el pago mal
-- fechado que se borra era el más reciente, la próxima cuota pendiente
-- se recalcula sola contra el pago real anterior en la próxima consulta,
-- sin ninguna migración de datos ni recálculo manual. Igual para saldo,
-- total pagado y % de avance (siempre sumados al vuelo desde `pagos`) —
-- borrar la fila basta para que el contrato entero quede consistente.
-- ============================================================

create or replace function public.eliminar_pago(p_pago_id uuid)
returns public.pagos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago public.pagos%rowtype;
begin
  if coalesce(public.fn_rol_actual(), '') not in ('admin', 'asesor') then
    raise exception 'No autorizado para eliminar pagos';
  end if;

  select * into v_pago
  from public.pagos
  where id = p_pago_id
  for update;                      -- 🔒 bloqueo pesimista del pago

  if not found then
    raise exception 'Pago no encontrado';
  end if;

  perform 1
  from public.contratos
  where id = v_pago.contrato_id
  for update;                      -- 🔒 mismo bloqueo que registrar_pago/editar_monto_pago

  delete from public.pagos where id = p_pago_id;

  return v_pago;
end;
$$;
