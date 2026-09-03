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
