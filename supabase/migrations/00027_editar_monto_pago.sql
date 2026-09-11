-- ============================================================
-- WALY MOTORS OS — Migración 00027
--
-- Pedido real: el cajero se confunde de monto al cobrar (tipeo S/ 150
-- en vez de S/ 50, o al revés) y hasta ahora la única forma de
-- corregirlo era eliminar el CONTRATO completo y rehacerlo desde cero
-- — perdiendo firma, garantías, PDF y el resto del historial de pagos
-- por un solo número mal tipeado.
--
-- Nueva RPC `editar_monto_pago`: corrige el monto de UN pago ya
-- registrado, sin tocar el contrato ni el resto del historial. Mismo
-- criterio de seguridad y concurrencia que `registrar_pago` /
-- `editar_contrato`:
--   • Solo admin/asesor (`fn_rol_actual`).
--   • Bloqueo pesimista del pago y del contrato dueño (evita que la
--     corrección se cruce con un cobro nuevo concurrente sobre el mismo
--     contrato).
--   • Nunca permite un monto <= 0 (además del CHECK ya existente en la
--     columna, para devolver un mensaje en español, no el genérico de
--     Postgres).
--
-- Deliberadamente NO se toca `fecha_pago` ni `metodo_pago`: el pedido es
-- puntual ("me equivoqué de MONTO"), y tocar la fecha reabriría el
-- cálculo de mora/cronograma (ver migración 00026) sin necesidad — si el
-- error fuera de fecha o método, ese es un caso aparte.
--
-- Auditoría sin ensuciar `observaciones`: se agregan dos columnas
-- nuevas, `monto_original` y `motivo_edicion`, en vez de concatenar un
-- texto dentro de `observaciones` — esa columna ya se usa para marcar la
-- cuota inicial y los pagos migrados del cuaderno (migraciones 00021 y
-- 00025) y el detalle de contrato la muestra tal cual en una etiqueta
-- corta; mezclarle una nota de auditoría la rompería visualmente y
-- arriesgaría el texto exacto que usa la migración 00025 para
-- identificar la cuota inicial. `monto_original` solo se graba la
-- PRIMERA vez que se corrige un pago (con `coalesce`), así que si se
-- corrige más de una vez, sigue mostrando el monto con el que
-- realmente se cobró en calle — nunca un valor intermedio.
--
-- `estado` (completado/parcial) se recalcula con la MISMA fórmula que ya
-- usa `registrar_pago` — nunca aparte —, salvo dos excepciones:
--   • La cuota inicial (`es_cuota_inicial`, migración 00025) nunca se
--     compara contra `monto_cuota`: es un monto de entrega, no una cuota
--     periódica.
--   • Un pago ya marcado 'rechazado' se queda así — corregir el monto no
--     debe "resucitarlo" a completado/parcial en silencio.
--
-- Todo lo demás (saldo, % de avance, mora, "Caja hoy") ya se calcula al
-- vuelo a partir de `pagos` (ver `resumen_contrato` / `kpis_dashboard` /
-- `obtener_clientes_en_mora`, migraciones 00023/00025) — ningún total se
-- guarda aparte, así que corregir `monto_recibido` aquí basta para que
-- todo el resto del sistema quede consistente sin tocar nada más.
-- ============================================================

alter table public.pagos
  add column monto_original numeric(10,2),
  add column motivo_edicion text;

create or replace function public.editar_monto_pago(
  p_pago_id uuid,
  p_monto   numeric,
  p_motivo  text default null
)
returns public.pagos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago     public.pagos%rowtype;
  v_contrato public.contratos%rowtype;
begin
  if coalesce(public.fn_rol_actual(), '') not in ('admin', 'asesor') then
    raise exception 'No autorizado para editar pagos';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor a cero';
  end if;

  select * into v_pago
  from public.pagos
  where id = p_pago_id
  for update;                      -- 🔒 bloqueo pesimista del pago

  if not found then
    raise exception 'Pago no encontrado';
  end if;

  select * into v_contrato
  from public.contratos
  where id = v_pago.contrato_id
  for update;                      -- 🔒 mismo bloqueo que registrar_pago/editar_contrato

  if not found then
    raise exception 'Contrato no encontrado';
  end if;

  update public.pagos
  set monto_recibido = p_monto,
      monto_original  = coalesce(v_pago.monto_original, v_pago.monto_recibido),
      motivo_edicion  = nullif(trim(coalesce(p_motivo, '')), ''),
      estado = case
                 when v_pago.es_cuota_inicial then 'completado'
                 when v_pago.estado = 'rechazado' then v_pago.estado
                 when p_monto >= v_contrato.monto_cuota then 'completado'
                 else 'parcial'
               end
  where id = p_pago_id
  returning * into v_pago;

  return v_pago;
end;
$$;
