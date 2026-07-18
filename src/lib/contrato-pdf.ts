import { jsPDF } from "jspdf";
import { soles, type FrecuenciaPago } from "@/lib/supabase";

// ── Colores de marca en RGB ──────────────────────────────────
const COBRE: [number, number, number] = [201, 123, 61];
const GRAFITO: [number, number, number] = [32, 31, 29];
const GRIS: [number, number, number] = [140, 137, 131];
const BORDE: [number, number, number] = [234, 231, 225];

const LABEL_FRECUENCIA: Record<FrecuenciaPago, string> = {
  diario: "diaria",
  semanal: "semanal",
  quincenal: "quincenal",
  mensual: "mensual",
};

const fecha = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "long", year: "numeric" });
const fechaHora = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export interface DatosContratoPdf {
  contratoId: string;
  tipo: "alquiler" | "venta_credito";
  creadoEnIso: string;
  clienteNombre: string;
  clienteTipoDocumento: "DNI" | "RUC";
  clienteDocumento: string;
  clienteDireccion?: string | null;
  clienteTelefono?: string | null;
  vehiculoPlaca: string;
  vehiculoModelo: string;
  vehiculoAnio: number;
  vehiculoChasis: string;
  vehiculoKm: number;
  montoTotal: number;
  cuotaInicial: number;
  montoCuota: number;
  frecuenciaPago: FrecuenciaPago;
  numCuotasEstimadas: number;
  fechaInicioIso: string;
  fechaFinIso?: string | null;
  firmaBase64?: string | null;
  firmaFechaIso?: string | null;
  documentosGarantia?: string[];
}

/** Hash corto y determinístico (FNV-1a de 32 bits) — solo como marca de
 *  integridad interna, no representa una firma criptográfica certificada. */
function codigoVerificacion(texto: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    hash ^= texto.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/** Nombre de archivo legible a partir de una ruta interna `carpeta/169900-foto.jpg`. */
function nombreLegible(ruta: string): string {
  const base = ruta.split("/").pop() ?? ruta;
  return base.replace(/^\d+-/, "");
}

export function generarContratoPdf(d: DatosContratoPdf): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const margenX = 18;
  const margenInferior = 20;
  let y = 0;

  function nuevaPagina() {
    doc.addPage();
    y = 20;
  }

  function verificarEspacio(necesaria: number) {
    if (y + necesaria > alto - margenInferior) nuevaPagina();
  }

  function titulo(texto: string) {
    verificarEspacio(10);
    doc.setTextColor(...COBRE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(texto, margenX, y);
    y += 2;
    doc.setDrawColor(...COBRE);
    doc.setLineWidth(0.5);
    doc.line(margenX, y, ancho - margenX, y);
    y += 6;
  }

  function filaDatos(filas: [string, string][]) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    for (const [etiqueta, valor] of filas) {
      // El alto real depende de cuántas líneas ocupa el valor (direcciones
      // largas envuelven) — hay que calcularlo ANTES de verificar espacio,
      // si no, el texto puede escribirse más allá del margen inferior.
      const lineas = doc.splitTextToSize(valor, ancho - margenX * 2 - 45);
      const altura = Math.max(6, lineas.length * 4.6);
      verificarEspacio(altura);
      doc.setTextColor(...GRIS);
      doc.text(etiqueta, margenX, y);
      doc.setTextColor(...GRAFITO);
      doc.setFont("helvetica", "bold");
      doc.text(lineas, margenX + 45, y);
      doc.setFont("helvetica", "normal");
      y += altura;
    }
    y += 3;
  }

  function parrafo(texto: string) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAFITO);
    doc.setFontSize(9.5);
    const lineas = doc.splitTextToSize(texto, ancho - margenX * 2);
    for (const linea of lineas) {
      verificarEspacio(5);
      doc.text(linea, margenX, y);
      y += 4.6;
    }
    y += 3;
  }

  // ── Portada / membrete ──────────────────────────────────────
  doc.setFillColor(...COBRE);
  doc.rect(0, 0, ancho, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("WALY MOTORS", margenX, 14);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(
    d.tipo === "alquiler"
      ? "Contrato de alquiler de mototaxi"
      : "Contrato de venta a crédito de mototaxi",
    margenX,
    22,
  );
  doc.setFontSize(9);
  doc.text(`N° ${d.contratoId.slice(0, 8).toUpperCase()}`, ancho - margenX, 14, { align: "right" });
  doc.text(fecha.format(new Date(d.creadoEnIso)), ancho - margenX, 20, { align: "right" });

  y = 42;

  // ── I. Partes ────────────────────────────────────────────────
  titulo(d.tipo === "alquiler" ? "I. PARTES — ARRENDADOR Y ARRENDATARIO" : "I. PARTES — VENDEDOR Y COMPRADOR");
  filaDatos([
    [d.tipo === "alquiler" ? "Arrendador" : "Vendedor", "Waly Motors — Waldir Yarlequé"],
    ["RUC", "____________________"],
    ["Dirección", "____________________"],
    [d.tipo === "alquiler" ? "Arrendatario" : "Comprador", d.clienteNombre],
    [d.clienteTipoDocumento, d.clienteDocumento],
    ["Dirección", d.clienteDireccion || "No registrada"],
    ["Teléfono", d.clienteTelefono || "No registrado"],
  ]);

  // ── II. Vehículo ─────────────────────────────────────────────
  titulo("II. VEHÍCULO OBJETO DEL CONTRATO");
  filaDatos([
    ["Placa", d.vehiculoPlaca],
    ["Modelo", `${d.vehiculoModelo} ${d.vehiculoAnio}`],
    ["N° de chasis", d.vehiculoChasis],
    ["Kilometraje al inicio", `${d.vehiculoKm.toLocaleString("es-PE")} km`],
  ]);

  // ── III. Condiciones económicas ──────────────────────────────
  titulo("III. CONDICIONES ECONÓMICAS");
  filaDatos([
    ["Monto total", soles.format(d.montoTotal)],
    ["Cuota inicial", soles.format(d.cuotaInicial)],
    ["Monto por cuota", soles.format(d.montoCuota)],
    ["Frecuencia de pago", LABEL_FRECUENCIA[d.frecuenciaPago]],
    ["N° de cuotas estimadas", String(d.numCuotasEstimadas)],
    ["Fecha de inicio", fecha.format(new Date(`${d.fechaInicioIso}T12:00:00`))],
    ...(d.fechaFinIso
      ? ([["Fecha de fin", fecha.format(new Date(`${d.fechaFinIso}T12:00:00`))]] as [string, string][])
      : []),
  ]);

  // ── IV. Cláusulas ────────────────────────────────────────────
  titulo("IV. CLÁUSULAS");
  const objeto =
    d.tipo === "alquiler"
      ? `1. OBJETO. El arrendador entrega en alquiler al arrendatario la mototaxi descrita en la sección II, para su uso lícito de transporte, por el plazo y bajo las condiciones económicas establecidas en la sección III.`
      : `1. OBJETO. El vendedor transfiere al comprador la mototaxi descrita en la sección II bajo la modalidad de venta a crédito, según el monto total y el plan de cuotas establecido en la sección III.`;
  parrafo(objeto);
  parrafo(
    `2. OBLIGACIÓN DE PAGO. El ${d.tipo === "alquiler" ? "arrendatario" : "comprador"} se obliga a cancelar cada cuota en la fecha correspondiente según la frecuencia ${LABEL_FRECUENCIA[d.frecuenciaPago]} pactada. El atraso en el pago genera días de mora contados desde el vencimiento de cada cuota, información que Waly Motors OS registra y comunica al cliente.`,
  );
  parrafo(
    d.tipo === "alquiler"
      ? `3. MANTENIMIENTO. El mantenimiento preventivo mecánico ordinario de la mototaxi es responsabilidad del arrendador, salvo daños originados por uso indebido o negligente del arrendatario, en cuyo caso el costo de reparación corre por cuenta de este último.`
      : `3. MANTENIMIENTO. A partir de la entrega, el mantenimiento y conservación de la mototaxi son responsabilidad exclusiva del comprador, sin perjuicio de las garantías de fábrica que pudieran corresponder.`,
  );
  parrafo(
    `4. USO DEL VEHÍCULO. La mototaxi debe destinarse únicamente a fines lícitos de transporte. Queda prohibido el subarriendo o cesión del presente contrato a terceros sin autorización escrita de Waly Motors.`,
  );
  if (d.tipo === "alquiler") {
    parrafo(
      `5. DEVOLUCIÓN. Al finalizar el contrato, la mototaxi debe devolverse en condiciones normales de uso, considerando el desgaste propio del tiempo transcurrido.`,
    );
  }
  parrafo(
    `${d.tipo === "alquiler" ? "6" : "5"}. RESOLUCIÓN. Waly Motors podrá dar por resuelto el presente contrato en caso de atraso prolongado en el pago de las cuotas, uso indebido del vehículo, o incumplimiento de cualquiera de las cláusulas aquí establecidas.`,
  );
  parrafo(
    `${d.tipo === "alquiler" ? "7" : "6"}. JURISDICCIÓN. Para efectos del presente contrato, las partes se someten a la jurisdicción de los juzgados de Piura, Perú.`,
  );
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS);
  parrafo(
    `Nota: este documento fue generado automáticamente por Waly Motors OS como resumen de las condiciones acordadas entre las partes. Se recomienda la revisión de un asesor legal para casos que así lo requieran.`,
  );
  doc.setFont("helvetica", "normal");

  // ── V. Firma ─────────────────────────────────────────────────
  titulo("V. FIRMA");
  const codigo = codigoVerificacion(`${d.contratoId}|${d.creadoEnIso}|${d.montoTotal}`);
  if (d.firmaBase64) {
    verificarEspacio(38);
    try {
      doc.addImage(d.firmaBase64, "PNG", margenX, y, 60, 28);
    } catch {
      // Si la imagen no se puede decodificar, se omite sin romper el resto del PDF.
    }
    doc.setDrawColor(...BORDE);
    doc.line(margenX, y + 30, margenX + 60, y + 30);
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    doc.text(d.clienteNombre, margenX, y + 34);
    y += 40;
  } else {
    parrafo("Sin firma registrada.");
  }
  filaDatos([
    ["Firmado el", d.firmaFechaIso ? fechaHora.format(new Date(d.firmaFechaIso)) : "—"],
    ["Código de verificación", codigo],
  ]);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...GRIS);
  parrafo(
    "Firma electrónica simple registrada en el sistema (trazo capturado digitalmente). No constituye una firma digital certificada con validez criptográfica.",
  );
  doc.setFont("helvetica", "normal");

  // ── VI. Documentos de garantía adjuntos ──────────────────────
  if (d.documentosGarantia && d.documentosGarantia.length > 0) {
    titulo("VI. DOCUMENTOS DE GARANTÍA ADJUNTOS");
    doc.setFontSize(9.5);
    doc.setTextColor(...GRAFITO);
    for (const ruta of d.documentosGarantia) {
      verificarEspacio(5);
      doc.text(`• ${nombreLegible(ruta)}`, margenX, y);
      y += 5;
    }
  }

  return doc;
}
