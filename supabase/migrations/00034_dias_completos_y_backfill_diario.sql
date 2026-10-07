-- ============================================================
-- WALY MOTORS OS — Migración 00034
--
-- Dos bugs reales reportados tras 00033:
--
-- 1) HUECOS en contratos semanales/quincenales/mensuales: el cronograma
--    de 00033 solo generaba UNA fila por período (el día ancla cada
--    7/15/30 días desde `fecha_inicio`) — nunca los demás días de esa
--    semana/quincena/mes. El calendario solo tenía datos para pintar esa
--    única fila por período; el resto de días de cada semana quedaban
--    sin ningún registro (ni verde ni rojo). Corrección: el cronograma
--    ahora expande cada período en TODOS sus días calendario — si la
--    semana completa tiene un pago que la cubre, los 7 días se pintan
--    verdes; si no, los 7 se pintan rojos una vez que la semana ya
--    terminó (nunca antes de su propia fecha de vencimiento).
--
-- 2) Mora disparada (191/187/185... días) en contratos DIARIOS: 00033
--    reconstruyó el rango de cobertura de los pagos YA EXISTENTES solo
--    para contratos semanales/quincenales/mensuales — los diarios se
--    quedaron sin backfill. Antes de 00032, un pago grande en un
--    contrato diario (ej. "me adelanto 7 días") se repartía por monto y
--    cubría varios días; al pasar a cobertura 100% explícita, esos pagos
--    volvieron a cubrir solo su propio día — y todo lo que antes cubrían
--    se convirtió de golpe en mora.
--
--    Corrección: se reconstruye, una sola vez, el rango real de cada
--    pago diario YA REGISTRADO (`cobertura_desde`/`cobertura_hasta`
--    siguen en null para esos) recorriendo los días del cronograma en
--    orden y los pagos del contrato en orden de fecha, asignando a cada
--    pago tantos días consecutivos como alcance su monto (con la tarifa
--    de domingo donde aplique) — el mismo criterio que ya usaba el
--    reparto por monto de 00032, pero grabado como rango explícito de
--    una vez por todas, no recalculado en cada lectura (así nunca vuelve
--    a pasar lo del "día 5 en verde sin pago" que corrigió 00033). Un
--    pago que no alcanza para cubrir ni un día completo (ej. una
--    corrección a S/ 0.10) se deja cubriendo solo su propio día, igual
--    que el comportamiento por defecto de todo el sistema.
--
--    No se toca ningún monto, ningún pago nuevo, ni contratos
--    semanales/quincenales/mensuales (esos ya quedaron bien en 00033).
-- ============================================================

create or replace function public.cronograma_contrato(p_contrato_id uuid)
returns table (
  fecha    date,
  esperado numeric,
  al_dia   boolean,
  en_mora  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with
  hoy as (
    select (now() at time zone 'America/Lima')::date as d
  ),
  c as (
    select
      ct.id,
      ct.fecha_inicio,
      ct.fecha_fin,
      ct.frecuencia_pago,
      ct.monto_cuota,
      ct.monto_domingo,
      ct.estado
    from public.contratos ct
    where ct.id = p_contrato_id
  ),
  rangos as (
    select
      coalesce(p.cobertura_desde, p.fecha_pago::date) as desde,
      coalesce(p.cobertura_hasta, p.fecha_pago::date) as hasta
    from public.pagos p
    where p.contrato_id = p_contrato_id
      and p.estado in ('completado', 'parcial')
      and not p.es_cuota_inicial
  ),
  -- Un ancla por período (cada día/semana/quincena/mes desde fecha_inicio
  -- — igual que antes), pero ahora cada ancla se expande más abajo en
  -- TODOS los días que dura su propio período, no se queda como una
  -- fila suelta.
  anclas as (
    select
      s::date as inicio,
      c.fecha_fin,
      hoy.d as hoy_d
    from c
    cross join hoy
    cross join lateral generate_series(
      c.fecha_inicio::timestamp,
      least(
        coalesce(c.fecha_fin, date '9999-12-31'),
        hoy.d + 400
      )::timestamp,
      case c.frecuencia_pago
        when 'semanal'   then interval '7 days'
        when 'quincenal' then interval '15 days'
        when 'mensual'   then interval '1 month'
        else interval '1 day'
      end
    ) as s
  ),
  periodos as (
    select
      inicio,
      coalesce(
        lead(inicio) over (order by inicio) - 1,
        least(coalesce(fecha_fin, date '9999-12-31'), hoy_d + 400)
      ) as fin
    from anclas
  ),
  dias as (
    select
      d::date as fecha,
      p.fin as periodo_fin,
      case
        when c.frecuencia_pago = 'diario'
         and c.monto_domingo is not null
         and extract(dow from d) = 0
        then c.monto_domingo
        else c.monto_cuota
      end as esperado,
      c.estado as contrato_estado
    from periodos p
    cross join c
    cross join lateral generate_series(p.inicio::timestamp, p.fin::timestamp, interval '1 day') as d
  )
  select
    di.fecha,
    di.esperado,
    exists(select 1 from rangos r where di.fecha between r.desde and r.hasta) as al_dia,
    (
      not exists(select 1 from rangos r where di.fecha between r.desde and r.hasta)
      -- Un período no está "en mora" hasta que TERMINA — una semana que
      -- recién empieza no se pinta roja a mitad de camino.
      and di.periodo_fin < (select d from hoy)
      and di.contrato_estado = 'activo'
    ) as en_mora
  from dias di
  order by di.fecha;
$$;

-- Reconstrucción, una sola vez, del rango real de los pagos diarios ya
-- registrados que todavía no tienen cobertura explícita (ver nota 2
-- arriba). No toca pagos que ya tengan `cobertura_desde` asignado (por
-- ejemplo, uno que un asesor ya haya registrado con rango explícito
-- después de que existiera esa opción).
do $$
declare
  v_contrato record;
  v_pago     record;
  v_dia      date;
  v_restante numeric;
  v_costo    numeric;
  v_desde    date;
  v_dias_cubiertos integer;
begin
  for v_contrato in
    select id, fecha_inicio, monto_cuota, monto_domingo
    from public.contratos
    where frecuencia_pago = 'diario'
  loop
    v_dia := v_contrato.fecha_inicio; -- puntero: primer día del cronograma aún sin cubrir

    for v_pago in
      select id, monto_recibido, fecha_pago
      from public.pagos
      where contrato_id = v_contrato.id
        and estado in ('completado', 'parcial')
        and not es_cuota_inicial
        and cobertura_desde is null
      order by fecha_pago asc, id asc
    loop
      v_restante := v_pago.monto_recibido;
      v_desde := v_dia;
      v_dias_cubiertos := 0;

      loop
        v_costo := public.monto_cuota_del_dia(v_contrato.monto_cuota, v_contrato.monto_domingo, v_dia::timestamp);
        exit when v_restante < v_costo;
        v_restante := v_restante - v_costo;
        v_dias_cubiertos := v_dias_cubiertos + 1;
        v_dia := v_dia + 1;
      end loop;

      if v_dias_cubiertos > 0 then
        update public.pagos
        set cobertura_desde = v_desde,
            cobertura_hasta = v_dia - 1
        where id = v_pago.id;
      else
        -- No alcanza ni para un día completo (ej. una corrección a
        -- S/ 0.10 vía editar_monto_pago): cubre solo su propio día,
        -- como el comportamiento por defecto de siempre.
        update public.pagos
        set cobertura_desde = v_pago.fecha_pago::date,
            cobertura_hasta = v_pago.fecha_pago::date
        where id = v_pago.id;
      end if;
    end loop;
  end loop;
end $$;
