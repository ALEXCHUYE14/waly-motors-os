-- ============================================================
-- WALY MOTORS OS — Migración 00029
--
-- Pedido real del dueño del negocio: poder registrar un pago
-- ADELANTADO — un cliente paga hoy para cubrir un día futuro del
-- cronograma (ej. adelanta el domingo que viene). Hasta ahora
-- `registrar_pago` rechazaba cualquier `p_fecha_pago` posterior a
-- `now()` sin distinción (migración 00021):
--
--   if p_fecha_pago is not null and p_fecha_pago > now() then
--     raise exception 'No se puede registrar un pago con fecha futura';
--   end if;
--
-- Se relaja ÚNICAMENTE para cobros EN VIVO (yape/plin/efectivo/
-- transferencia). "Abono adicional" (pago del cuaderno, migración
-- 00021) sigue sin poder llevar fecha futura: por definición es un
-- pago que YA ocurrió y quedó anotado en papel — fecharlo a futuro no
-- tiene sentido y contradice su propio propósito.
--
-- Tope de 1 año en vez de sin límite: un typo de fecha (año
-- equivocado) fijaría `proximo_vencimiento` a años de distancia —
-- escondería la mora real del contrato por mucho tiempo sin que nadie
-- lo note. Un año cubre cualquier adelanto real razonable (incluso un
-- cliente que adelanta varios meses de cuotas de una sola vez) sin
-- dejar la puerta abierta a ese error silencioso. Mismo tope aplicado
-- también en el frontend (ver registro-express.tsx) — nunca depende
-- solo de la validación del cliente, cualquiera con el token podría
-- llamar la RPC directo.
--
-- Sin cambios en ningún otro lado: `proximo_vencimiento` ya se calcula
-- como `max(fecha_pago) + intervalo` (migración 00023/00025) — si
-- ahora `max(fecha_pago)` cae en el futuro porque el cliente adelantó,
-- la próxima cuota pendiente y los "días de atraso" (`greatest(...,0)`,
-- nunca negativo) ya reflejan correctamente que el contrato quedó al
-- día o adelantado, sin tocar `resumen_contrato` ni
-- `obtener_clientes_en_mora`. El calendario de pagos tampoco necesita
-- cambios: ya pinta cualquier fecha en `fechasConPago`, pasada o
-- futura, y el color azul de "pago en domingo" (ver
-- calendario-pagos.tsx) se calcula solo por el día de la semana de esa
-- fecha — un domingo adelantado se ve azul igual que uno de hoy.
-- ============================================================

create or replace function public.registrar_pago(
  p_contrato_id   uuid,
  p_monto         numeric,
  p_metodo        text,
  p_evidencia_url text default null,
  p_observaciones text default null,
  p_fecha_pago    timestamptz default null
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
  if coalesce(public.fn_rol_actual(), '') not in ('admin', 'asesor') then
    raise exception 'No autorizado para registrar pagos';
  end if;

  if p_fecha_pago is not null then
    if p_metodo = 'abono_adicional' and p_fecha_pago > now() then
      raise exception 'Un abono adicional (pago del cuaderno) no puede tener fecha futura — ya ocurrió';
    end if;

    if p_fecha_pago > now() + interval '1 year' then
      raise exception 'La fecha del pago no puede ser más de un año en el futuro';
    end if;
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
    estado, recaudador_id, evidencia_url, observaciones, fecha_pago
  ) values (
    p_contrato_id,
    p_monto,
    p_metodo,
    case when p_monto >= v_contrato.monto_cuota then 'completado' else 'parcial' end,
    auth.uid(),
    p_evidencia_url,
    p_observaciones,
    coalesce(p_fecha_pago, now())
  )
  returning * into v_pago;

  return v_pago;
end;
$$;
