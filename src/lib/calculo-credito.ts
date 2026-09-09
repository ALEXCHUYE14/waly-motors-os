/**
 * WALY MOTORS OS — Cálculo de crédito por tarifa diaria diferenciada
 * ───────────────────────────────────────────────────────────────
 * Usado en el paso "Condiciones" del wizard de Nuevo Contrato cuando el
 * asesor elige "Automático por tarifa diaria" para una venta a crédito:
 * en vez de sumar a mano cuánto cuesta la moto en N meses (Lunes a
 * Sábado a una tarifa, Domingo a otra), el sistema proyecta la fecha de
 * inicio real N meses hacia adelante y cuenta los días reales del
 * calendario.
 *
 * Deliberadamente sin date-fns/dayjs/Luxon: el proyecto no usa ninguna
 * librería de fechas en ningún otro archivo, y el cálculo exacto no las
 * necesita — `Date` nativo, anclado al mediodía (evita que un cambio de
 * horario de verano empuje la fecha al día anterior/siguiente, mismo
 * criterio que el resto del sistema) e iterando día por día, ya da el
 * resultado exacto sin aproximaciones de "30 días por mes".
 */

// ── Redondeo monetario ───────────────────────────────────────
/** Redondea a 2 decimales evitando el clásico error de punto flotante
 *  (ej. 1.005 → 1 en vez de 1.01 con un `Math.round` directo). */
export function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Suma de meses calendario exacta ──────────────────────────
/**
 * Suma `meses` meses calendario a una fecha ISO (`YYYY-MM-DD`), con el
 * mismo criterio que usan bancos/financieras: si el día de origen no
 * existe en el mes de destino (ej. 31 de enero + 1 mes), se ajusta al
 * ÚLTIMO día de ese mes (28/29 de febrero) — nunca se "desborda" al mes
 * siguiente (el bug clásico de `new Date(2024, 1, 31)` → 3 de marzo).
 * Maneja años bisiestos correctamente porque consulta el calendario real
 * (`new Date(año, mes+1, 0)` = último día de `mes`), no una tabla fija.
 */
export function sumarMeses(fechaISO: string, meses: number): string {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  const mesIndiceObjetivo = mes - 1 + meses; // 0-indexado; puede desbordar años, Date lo normaliza bien
  const ultimoDiaMesObjetivo = new Date(anio, mesIndiceObjetivo + 1, 0).getDate();
  const diaFinal = Math.min(dia, ultimoDiaMesObjetivo);
  const fecha = new Date(anio, mesIndiceObjetivo, diaFinal, 12); // mediodía: ver nota de horario de verano arriba

  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Suma de días calendario exacta ───────────────────────────
/** Suma `dias` días calendario a una fecha ISO — delega en el motor
 *  nativo de `Date` (anclado al mediodía), que ya normaliza correctamente
 *  el desborde de mes/año (28/30/31 días, bisiestos) sin ninguna tabla ni
 *  aproximación propia. */
export function sumarDias(fechaISO: string, dias: number): string {
  const fecha = new Date(`${fechaISO}T12:00:00`);
  fecha.setDate(fecha.getDate() + dias);
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Combina meses + días sueltos en una sola fecha final, en el orden
 * exacto pedido — PRIMERO los meses (calendario real, con el mismo
 * "clamp" de fin de mes que `sumarMeses`), DESPUÉS los días sobre la
 * fecha resultante. Este orden no es intercambiable con "sumar todo como
 * días": partiendo del 31 de enero, +1 mes ya cae en 28/29 de febrero
 * (2-3 días "menos" que sumar 31 días corridos), así que el resultado
 * final SÍ depende de qué se sume primero. Se usa este orden en todo el
 * sistema para "tiempo ya pagado", igual que lo especifica el negocio.
 */
export function sumarMesesYDias(fechaISO: string, meses: number, dias: number): string {
  return sumarDias(sumarMeses(fechaISO, meses), dias);
}

/**
 * Normaliza días sueltos ≥ 30 llevándolos a su equivalente en meses
 * completos — es una convención de ENTRADA/UI (para que el campo de días
 * no se quede con un número absurdo como "45" en vez de "1 mes y 15
 * días"), no una aproximación de cálculo: la fecha final siempre se
 * resuelve con `sumarMesesYDias`, que usa calendario real una vez fijados
 * los meses/días ya normalizados. Se aplica SIEMPRE antes de calcular
 * (no solo al mostrar en pantalla) para que el resultado no dependa de
 * cómo el asesor haya repartido el tiempo entre los dos campos — "45
 * días" y "1 mes y 15 días" deben dar exactamente el mismo resultado.
 */
export function normalizarMesesDias(meses: number, dias: number): { meses: number; dias: number } {
  const mesesExtra = Math.floor(dias / 30);
  return { meses: meses + mesesExtra, dias: dias - mesesExtra * 30 };
}

// ── Conteo real de días por tipo en un rango ─────────────────
export interface ConteoDias {
  diasLunesSabado: number;
  diasDomingo: number;
}

/**
 * Cuenta cuántos días de Lunes a Sábado y cuántos Domingos hay en el
 * rango [fechaInicioISO, fechaFinExclusivaISO) — el día de fin NO se
 * cuenta (es el mismo criterio que ya usa el resto del sistema para
 * `fecha_fin`: el contrato corre desde el inicio hasta justo antes de
 * esa fecha). Itera día por día — nunca aproxima con "duración × 30".
 */
export function contarDiasPorTipo(fechaInicioISO: string, fechaFinExclusivaISO: string): ConteoDias {
  const cursor = new Date(`${fechaInicioISO}T12:00:00`);
  const finExclusivo = new Date(`${fechaFinExclusivaISO}T12:00:00`);

  let diasLunesSabado = 0;
  let diasDomingo = 0;
  while (cursor < finExclusivo) {
    if (cursor.getDay() === 0) diasDomingo++;
    else diasLunesSabado++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return { diasLunesSabado, diasDomingo };
}

// ── Cálculo del monto total por tarifa diaria diferenciada ───
export interface ResultadoCalculoTotal extends ConteoDias {
  fechaFin: string;
  montoTotal: number;
}

export function esDuracionMesesValida(valor: string): boolean {
  const n = Number(valor);
  return valor.trim() !== "" && Number.isInteger(n) && n > 0;
}

export function esTarifaDiariaValida(valor: string): boolean {
  const n = Number(valor);
  return valor.trim() !== "" && Number.isFinite(n) && n > 0;
}

/**
 * Calcula el monto total de la moto proyectando la fecha de inicio real
 * `duracionMeses` meses hacia adelante y sumando:
 *   (días de Lunes a Sábado × tarifaLunesSabado) + (domingos × tarifaDomingo)
 *
 * Lanza un error legible (nunca un NaN silencioso) si algún parámetro no
 * es válido — duración entera > 0, tarifas > 0. El llamador decide cómo
 * mostrar el mensaje, igual que `validarDatosContrato` en contrato-pdf.ts.
 */
export function calcularMontoTotalPorTarifaDiaria(
  fechaInicioISO: string,
  duracionMeses: number,
  tarifaLunesSabado: number,
  tarifaDomingo: number,
): ResultadoCalculoTotal {
  if (!Number.isInteger(duracionMeses) || duracionMeses <= 0) {
    throw new Error("La duración del contrato debe ser un número entero de meses mayor a cero.");
  }
  if (!Number.isFinite(tarifaLunesSabado) || tarifaLunesSabado <= 0) {
    throw new Error("La tarifa de Lunes a Sábado debe ser mayor a cero.");
  }
  if (!Number.isFinite(tarifaDomingo) || tarifaDomingo <= 0) {
    throw new Error("La tarifa de Domingo debe ser mayor a cero.");
  }

  const fechaFin = sumarMeses(fechaInicioISO, duracionMeses);
  const { diasLunesSabado, diasDomingo } = contarDiasPorTipo(fechaInicioISO, fechaFin);
  const montoTotal = redondear2(diasLunesSabado * tarifaLunesSabado + diasDomingo * tarifaDomingo);

  return { fechaFin, diasLunesSabado, diasDomingo, montoTotal };
}

// ── Monto ya pagado (migración de cuaderno, meses + días) ────
export interface ResultadoAcumulado extends ConteoDias {
  /** Fecha hasta la que el cliente quedó al día — nunca posterior a hoy
   *  (ver `ajustadoAHoy`): es la fecha real usada para contar días y
   *  calcular `montoTotal`. */
  fechaHasta: string;
  /** `fechaInicio + meses/días ya pagados` SIN limitar a hoy — igual a
   *  `fechaHasta` salvo cuando `ajustadoAHoy` es `true`, en cuyo caso
   *  queda por delante de `fechaHasta` (informativo, para que la
   *  pantalla pueda explicarle al asesor qué se recortó y por qué). */
  fechaProyectada: string;
  /** `true` cuando `fechaInicio` + meses/días ya pagados proyecta más
   *  allá de hoy (dato de entrada probablemente equivocado: Fecha de
   *  Inicio sin corregir, o meses/días de más). El cálculo NUNCA se
   *  bloquea por esto — se recorta a hoy (`fechaHasta`) y se avisa. */
  ajustadoAHoy: boolean;
  montoTotal: number;
}

export function esCantidadNoNegativaValida(valor: string): boolean {
  const n = Number(valor);
  return valor.trim() !== "" && Number.isInteger(n) && n >= 0;
}

/** Hoy en `YYYY-MM-DD`, comparable como texto con las fechas que
 *  devuelven `sumarMeses`/`sumarDias`/`sumarMesesYDias` (mismo formato
 *  zero-padded) sin pasar por objetos `Date` — evita cualquier lío de
 *  huso horario en la comparación. */
function hoyISO(): string {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = String(hoy.getMonth() + 1).padStart(2, "0");
  const d = String(hoy.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Calcula cuánto representa, en soles, un tiempo YA PAGADO expresado en
 * meses + días sueltos (ej. "3 meses y 12 días") — usado al migrar un
 * cliente con pagos hechos en cuaderno antes de registrarse en el
 * sistema (ver migración 00021/00022). El origen del cálculo es SIEMPRE
 * `fechaInicioISO` — la Fecha de Inicio del Contrato — nunca la fecha de
 * hoy ni ninguna otra: es el mismo dato que ya define el resto del
 * contrato (cronograma, PDF), así que "tiempo ya pagado" siempre cuenta
 * hacia adelante desde ahí.
 *
 * Secuencia exacta:
 *   1) Normaliza días ≥ 30 a meses completos (`normalizarMesesDias`).
 *   2) `fechaInicio` + meses normalizados + días normalizados
 *      (`sumarMesesYDias`) → fecha hasta la que el cliente quedó al día.
 *   3) Recorre [fechaInicio, fechaHasta) día por día real, contando
 *      Lunes-Sábado vs. Domingo, y multiplica por cada tarifa.
 *
 * Lanza un error legible (nunca un NaN ni una fecha absurda silenciosa)
 * únicamente por datos de ENTRADA inválidos: meses o días negativos/no
 * enteros, o tarifas que no son > 0 — nunca por el RESULTADO de la
 * proyección. Si `fechaInicio` + meses/días ya pagados cae justo en hoy
 * o antes, se usa tal cual. Si cae DESPUÉS de hoy (Fecha de Inicio sin
 * corregir, o meses/días de más — un dato de entrada probablemente
 * equivocado, pero no algo que deba trabar el formulario), el cálculo
 * NUNCA falla ni deja el campo vacío: se recorta a hoy (`fechaHasta`,
 * usado para el monto) y se marca `ajustadoAHoy = true` junto con la
 * fecha sin recortar (`fechaProyectada`) para que la pantalla avise sin
 * bloquear ni "Continuar" ni "Guardar".
 */
export function calcularMontoAcumuladoPorTiempoPagado(
  fechaInicioISO: string,
  meses: number,
  dias: number,
  tarifaLunesSabado: number,
  tarifaDomingo: number,
): ResultadoAcumulado {
  if (!Number.isInteger(meses) || meses < 0) {
    throw new Error("Los meses ya pagados deben ser un número entero mayor o igual a cero.");
  }
  if (!Number.isInteger(dias) || dias < 0) {
    throw new Error("Los días ya pagados deben ser un número entero mayor o igual a cero.");
  }
  if (!Number.isFinite(tarifaLunesSabado) || tarifaLunesSabado <= 0) {
    throw new Error("La tarifa de Lunes a Sábado debe ser mayor a cero.");
  }
  if (!Number.isFinite(tarifaDomingo) || tarifaDomingo <= 0) {
    throw new Error("La tarifa de Domingo debe ser mayor a cero.");
  }

  const normalizado = normalizarMesesDias(meses, dias);
  const fechaProyectada = sumarMesesYDias(fechaInicioISO, normalizado.meses, normalizado.dias);
  const hoy = hoyISO();
  const ajustadoAHoy = fechaProyectada > hoy;
  const fechaHasta = ajustadoAHoy ? hoy : fechaProyectada;

  // Si `fechaInicioISO` mismo quedó en el futuro (Fecha de Inicio mal
  // puesta), el rango [fechaInicio, fechaHasta) queda vacío o invertido —
  // `contarDiasPorTipo` ya devuelve 0/0 en ese caso (su `while` nunca
  // arranca), nunca un conteo negativo ni un error.
  const { diasLunesSabado, diasDomingo } = contarDiasPorTipo(fechaInicioISO, fechaHasta);
  const montoTotal = redondear2(diasLunesSabado * tarifaLunesSabado + diasDomingo * tarifaDomingo);

  return { fechaHasta, fechaProyectada, ajustadoAHoy, diasLunesSabado, diasDomingo, montoTotal };
}
