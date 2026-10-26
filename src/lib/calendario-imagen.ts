/**
 * WALY MOTORS OS — Calendario de pagos como imagen
 * ─────────────────────────────────────────────────
 * Pedido del cliente: para avisar a los atrasados "hasta qué día pagan"
 * tenía que tomar captura al calendario del contrato y mandarla por
 * WhatsApp a mano. Esto genera esa misma "captura" automáticamente: un
 * PNG con el resumen (pagado hasta / días de atraso / monto vencido) y
 * la grilla de los últimos meses, pintada con los mismos colores que
 * `CalendarioPagos`.
 *
 * No calcula nada nuevo: los colores salen de `cronograma_contrato`
 * (00034) y la fecha "pagado hasta" de `resumen_contrato` (00035,
 * `proximo_vencimiento` = último día con cobertura real + 1). Es decir,
 * la imagen siempre dice lo mismo que la pantalla del contrato.
 *
 * PNG (no PDF) a propósito: WhatsApp muestra la imagen directamente en
 * el chat, igual que la captura que el cliente ya enviaba.
 */

import { supabase, soles } from "@/lib/supabase";
import { cargarLogoSistema } from "@/lib/utils";

// ── Colores (canvas no lee clases de Tailwind) ──
const FONDO = "#F9F9F7";
const TARJETA = "#FFFFFF";
const BORDE = "#EAE7E1";
const GRAFITO = "#201F1D";
const GRIS = "#8C8983";
const COBRE = "#C97B3D";
const AMARILLO = "#FFC400";
const OXIDO = "#C4472B";
const VERDE = "#059669"; // emerald-600
const VERDE_SUAVE = "rgba(16, 185, 129, 0.15)"; // emerald-500/15
const AZUL = "#0284C7"; // sky-600
const AZUL_SUAVE = "rgba(14, 165, 233, 0.15)"; // sky-500/15
const OXIDO_SUAVE = "rgba(196, 71, 43, 0.15)";

const DIAS_SEMANA = ["D", "L", "M", "M", "J", "V", "S"];
const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Como máximo se dibujan estos meses (los más recientes): más alto que
 *  eso la imagen deja de leerse bien en un celular. */
const MAX_MESES = 3;

const fechaLarga = new Intl.DateTimeFormat("es-PE", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export interface DiaCalendario {
  fecha: string; // YYYY-MM-DD
  esperado: number;
  al_dia: boolean;
  en_mora: boolean;
}

export interface DatosCalendario {
  clienteNombre: string;
  clienteTelefono: string | null;
  vehiculoPlaca: string;
  /** Último día con cobertura real (`proximo_vencimiento` − 1), o `null`
   *  si el contrato todavía no tiene ningún pago que cubra un día. */
  pagadoHasta: string | null;
  diasRetraso: number;
  /** Suma de lo esperado en los días en mora desde `pagadoHasta` — el
   *  atraso ACTUAL, no los huecos viejos ya superados (mismo criterio de
   *  recencia que `dias_retraso`, migración 00035). */
  montoVencido: number;
  dias: DiaCalendario[];
}

function sumarDias(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hoyISO(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
}

export function formatearFecha(iso: string): string {
  return fechaLarga.format(new Date(`${iso}T12:00:00`));
}

/** Arma los datos de la imagen a partir de lo que ya devuelven
 *  `resumen_contrato` y `cronograma_contrato`. */
export function armarDatosCalendario(
  resumen: {
    cliente_nombre: string;
    cliente_telefono: string | null;
    vehiculo_placa: string;
    proximo_vencimiento: string | null;
    dias_retraso: number;
  },
  dias: DiaCalendario[],
): DatosCalendario {
  const pagadoHasta = resumen.proximo_vencimiento
    ? sumarDias(resumen.proximo_vencimiento, -1)
    : null;
  // Sin próximo vencimiento: el último día cubierto del cronograma.
  const ultimoCubierto = [...dias].reverse().find((d) => d.al_dia)?.fecha ?? null;
  const desde = resumen.proximo_vencimiento;
  const montoVencido = dias
    .filter((d) => d.en_mora && (!desde || d.fecha >= desde))
    .reduce((acc, d) => acc + Number(d.esperado), 0);

  return {
    clienteNombre: resumen.cliente_nombre,
    clienteTelefono: resumen.cliente_telefono,
    vehiculoPlaca: resumen.vehiculo_placa,
    pagadoHasta: pagadoHasta ?? ultimoCubierto,
    diasRetraso: resumen.dias_retraso,
    montoVencido,
    dias,
  };
}

/** Variante para pantallas que solo tienen el `contrato_id` (Dashboard):
 *  pide las dos RPCs y arma los datos. */
export async function cargarDatosCalendario(contratoId: string): Promise<DatosCalendario> {
  const [resumen, cronograma] = await Promise.all([
    supabase.rpc("resumen_contrato", { p_contrato_id: contratoId }),
    supabase.rpc("cronograma_contrato", { p_contrato_id: contratoId }),
  ]);
  if (resumen.error) throw resumen.error;
  if (cronograma.error) throw cronograma.error;
  return armarDatosCalendario(resumen.data, (cronograma.data ?? []) as DiaCalendario[]);
}

/** Mensaje que acompaña la imagen. A diferencia del recordatorio de mora
 *  del Dashboard (que solo dice "N días de atraso"), aquí el cliente
 *  pidió explícitamente decir HASTA QUÉ DÍA está pagado. */
export function mensajeCalendario(d: DatosCalendario): string {
  const primerNombre = d.clienteNombre.split(" ")[0];
  let texto =
    `Hola ${primerNombre}, te saludamos de Wally Motors. ` +
    `Te enviamos el calendario de pagos de tu vehículo de placa ${d.vehiculoPlaca}. `;
  if (d.pagadoHasta) texto += `Tienes pagado hasta el ${formatearFecha(d.pagadoHasta)}. `;
  if (d.diasRetraso > 0) {
    const dias = `${d.diasRetraso} ${d.diasRetraso === 1 ? "día" : "días"}`;
    texto += `Llevas ${dias} de atraso (${soles.format(d.montoVencido)}). `;
    texto += `Puedes realizar tu pago vía Yape, Plin o en efectivo con nuestro recaudador. `;
  }
  return texto + `¡Gracias por tu preferencia! 🛺`;
}

/** Meses (año, mes 0-11) a dibujar: desde el mes en que se dejó de pagar
 *  hasta el mes actual, recortado a los `MAX_MESES` más recientes. */
function mesesADibujar(d: DatosCalendario): [number, number][] {
  const hoy = new Date();
  const inicioIso = d.diasRetraso > 0 && d.pagadoHasta ? sumarDias(d.pagadoHasta, 1) : hoyISO();
  const inicio = new Date(`${inicioIso}T12:00:00`);
  const meses: [number, number][] = [];
  let a = inicio.getFullYear();
  let m = inicio.getMonth();
  while (a < hoy.getFullYear() || (a === hoy.getFullYear() && m <= hoy.getMonth())) {
    meses.push([a, m]);
    m += 1;
    if (m > 11) {
      m = 0;
      a += 1;
    }
  }
  return meses.slice(-MAX_MESES);
}

function rectRedondeado(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ANCHO = 1080;
const MARGEN = 48;
const CELDA = (ANCHO - MARGEN * 2 - 48) / 7; // 48 = padding interno de la tarjeta

/** Dibuja la imagen del calendario y la devuelve como PNG. */
export async function generarImagenCalendario(d: DatosCalendario): Promise<Blob> {
  // Misma tipografía que la app: `next/font` le da un nombre generado a
  // Archivo, así que se lee del body en vez de escribirlo a mano.
  await document.fonts?.ready;
  const FUENTE = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const meses = mesesADibujar(d);
  const filasPorMes = meses.map(([a, m]) => {
    const primer = new Date(a, m, 1).getDay();
    const diasEnMes = new Date(a, m + 1, 0).getDate();
    return Math.ceil((primer + diasEnMes) / 7);
  });

  const logo = await cargarLogoSistema();
  const altoLogo = logo ? Math.min(140, 260 * (logo.naturalHeight / logo.naturalWidth)) : 0;
  const altoCabecera = MARGEN + altoLogo + (logo ? 24 : 0) + 150;
  const altoResumen = 230;
  const altoMeses = filasPorMes.reduce((acc, f) => acc + 24 + 70 + 44 + f * CELDA + 24 + 32, 0);
  const altoLeyenda = 70;
  const alto = altoCabecera + altoResumen + altoMeses + altoLeyenda + MARGEN;

  const canvas = document.createElement("canvas");
  canvas.width = ANCHO;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo generar la imagen del calendario");

  ctx.fillStyle = FONDO;
  ctx.fillRect(0, 0, ANCHO, alto);

  // ── Cabecera ──
  let y = MARGEN;
  if (logo) {
    const anchoLogo = altoLogo * (logo.naturalWidth / logo.naturalHeight);
    ctx.drawImage(logo, (ANCHO - anchoLogo) / 2, y, anchoLogo, altoLogo);
    y += altoLogo + 24;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COBRE;
  ctx.font = `800 30px ${FUENTE}`;
  ctx.fillText("CALENDARIO DE PAGOS", ANCHO / 2, y + 34);
  ctx.fillStyle = GRAFITO;
  ctx.font = `800 44px ${FUENTE}`;
  ctx.fillText(d.clienteNombre, ANCHO / 2, y + 92);
  ctx.fillStyle = GRIS;
  ctx.font = `600 30px ${FUENTE}`;
  ctx.fillText(`Placa ${d.vehiculoPlaca}`, ANCHO / 2, y + 136);
  y = altoCabecera;

  // ── Resumen ──
  const enMora = d.diasRetraso > 0;
  rectRedondeado(ctx, MARGEN, y, ANCHO - MARGEN * 2, altoResumen - 30, 28);
  ctx.fillStyle = enMora ? "rgba(196, 71, 43, 0.06)" : "rgba(16, 185, 129, 0.06)";
  ctx.fill();
  ctx.strokeStyle = enMora ? "rgba(196, 71, 43, 0.3)" : "rgba(16, 185, 129, 0.3)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = GRIS;
  ctx.font = `700 24px ${FUENTE}`;
  ctx.fillText("PAGADO HASTA EL", ANCHO / 2, y + 52);
  ctx.fillStyle = enMora ? OXIDO : VERDE;
  ctx.font = `900 54px ${FUENTE}`;
  ctx.fillText(d.pagadoHasta ? formatearFecha(d.pagadoHasta) : "Sin pagos registrados", ANCHO / 2, y + 116);
  ctx.fillStyle = enMora ? OXIDO : VERDE;
  ctx.font = `700 30px ${FUENTE}`;
  ctx.fillText(
    enMora
      ? `${d.diasRetraso} ${d.diasRetraso === 1 ? "día" : "días"} de atraso · ${soles.format(d.montoVencido)} vencido`
      : "Al día ✓",
    ANCHO / 2,
    y + 166,
  );
  y += altoResumen;

  // ── Meses ──
  const hoy = hoyISO();
  const porFecha = new Map(d.dias.map((x) => [x.fecha, x]));
  meses.forEach(([anio, mes], i) => {
    const filas = filasPorMes[i];
    const altoTarjeta = 24 + 70 + 44 + filas * CELDA + 24;
    rectRedondeado(ctx, MARGEN, y, ANCHO - MARGEN * 2, altoTarjeta, 28);
    ctx.fillStyle = TARJETA;
    ctx.fill();
    ctx.strokeStyle = BORDE;
    ctx.lineWidth = 2;
    ctx.stroke();

    const x0 = MARGEN + 24;
    let yy = y + 24;
    ctx.fillStyle = GRAFITO;
    ctx.font = `900 34px ${FUENTE}`;
    ctx.textAlign = "center";
    ctx.fillText(`${MESES[mes].toUpperCase()} ${anio}`, ANCHO / 2, yy + 46);
    yy += 70;

    ctx.fillStyle = "rgba(32, 31, 29, 0.3)";
    ctx.font = `800 22px ${FUENTE}`;
    DIAS_SEMANA.forEach((ds, c) => ctx.fillText(ds, x0 + c * CELDA + CELDA / 2, yy + 28));
    yy += 44;

    const primer = new Date(anio, mes, 1).getDay();
    const diasEnMes = new Date(anio, mes + 1, 0).getDate();
    for (let dia = 1; dia <= diasEnMes; dia++) {
      const pos = primer + dia - 1;
      const cx = x0 + (pos % 7) * CELDA;
      const cy = yy + Math.floor(pos / 7) * CELDA;
      const iso = `${anio}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
      const info = porFecha.get(iso);
      const pagado = !!info?.al_dia;
      const domingo = pos % 7 === 0;
      const mora = !!info?.en_mora;

      const pad = 8;
      rectRedondeado(ctx, cx + pad, cy + pad, CELDA - pad * 2, CELDA - pad * 2, 18);
      if (pagado || mora) {
        ctx.fillStyle = pagado ? (domingo ? AZUL_SUAVE : VERDE_SUAVE) : OXIDO_SUAVE;
        ctx.fill();
      }
      if (iso === hoy) {
        ctx.strokeStyle = AMARILLO;
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      ctx.fillStyle = pagado ? (domingo ? AZUL : VERDE) : mora ? OXIDO : "rgba(32, 31, 29, 0.6)";
      ctx.font = `${pagado || mora ? 800 : 600} 30px ${FUENTE}`;
      ctx.fillText(String(dia), cx + CELDA / 2, cy + CELDA / 2 + 11);
    }

    y += altoTarjeta + 32;
  });

  // ── Leyenda ──
  const leyenda: [string, string][] = [
    [VERDE, "Pagado"],
    [AZUL, "Pagado (domingo)"],
    [OXIDO, "En mora"],
    [AMARILLO, "Hoy"],
  ];
  ctx.font = `600 24px ${FUENTE}`;
  ctx.textAlign = "left";
  const anchos = leyenda.map(([, t]) => 28 + ctx.measureText(t).width);
  const separacion = 36;
  let lx = (ANCHO - (anchos.reduce((a, b) => a + b, 0) + separacion * (leyenda.length - 1))) / 2;
  leyenda.forEach(([color, texto], i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lx + 9, y + 22, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = GRIS;
    ctx.fillText(texto, lx + 28, y + 31);
    lx += anchos[i] + separacion;
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo generar la imagen del calendario"))),
      "image/png",
    );
  });
}
