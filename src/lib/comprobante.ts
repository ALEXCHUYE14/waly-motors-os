import { jsPDF } from "jspdf";
import { soles, type MetodoPago } from "@/lib/supabase";
import { abrirWhatsApp, cargarLogoSistema } from "@/lib/utils";

// ── Colores de marca en RGB (jsPDF no lee clases de Tailwind) ──
const COBRE: [number, number, number] = [201, 123, 61]; // #C97B3D
const GRAFITO: [number, number, number] = [32, 31, 29]; // #201F1D
const GRIS: [number, number, number] = [140, 137, 131];
const BORDE: [number, number, number] = [234, 231, 225]; // #EAE7E1

const LABEL_METODO: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  yape: "Yape",
  plin: "Plin",
  transferencia: "Transferencia",
};

const fecha = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export interface DatosComprobante {
  folio: string;
  fechaIso: string; // fecha del pago, ISO
  clienteNombre: string;
  clienteDocumento?: string | null;
  vehiculoPlaca: string;
  vehiculoModelo?: string | null;
  monto: number;
  metodo: MetodoPago;
  observaciones?: string | null;
  saldoPendiente?: number | null;
  recaudador?: string | null;
}

/** Dibuja un comprobante de pago limpio en A5 vertical y devuelve el documento. */
export async function generarComprobantePago(d: DatosComprobante): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  const ancho = doc.internal.pageSize.getWidth();
  const margen = 12;
  let y = 6;

  // Logo del sistema, centrado arriba de la franja de marca — mantiene su
  // proporción real (el archivo no es un ícono cuadrado) para no verse
  // deformado.
  const logo = await cargarLogoSistema();
  if (logo) {
    const logoAncho = 32;
    const logoAlto = logoAncho * (logo.naturalHeight / logo.naturalWidth);
    try {
      doc.addImage(logo, "PNG", (ancho - logoAncho) / 2, y, logoAncho, logoAlto);
      y += logoAlto + 4;
    } catch {
      // Si el logo no se puede insertar, el comprobante sigue sin él.
    }
  }

  // Franja de marca
  const bandaY = y;
  doc.setFillColor(...COBRE);
  doc.rect(0, bandaY, ancho, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("WALY MOTORS", margen, bandaY + 13);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Comprobante de pago", margen, bandaY + 20);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text(`Folio ${d.folio}`, ancho - margen, bandaY + 13, { align: "right" });
  doc.text(fecha.format(new Date(d.fechaIso)), ancho - margen, bandaY + 19, { align: "right" });

  y = bandaY + 38;

  const seccion = (titulo: string, filas: [string, string][]) => {
    doc.setTextColor(...GRIS);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(titulo.toUpperCase(), margen, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    for (const [etiqueta, valor] of filas) {
      doc.setTextColor(...GRIS);
      doc.text(etiqueta, margen, y);
      doc.setTextColor(...GRAFITO);
      doc.setFont("helvetica", "bold");
      doc.text(valor, ancho - margen, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      y += 6;
    }
    y += 4;
  };

  seccion(
    "Cliente",
    [
      ["Nombre", d.clienteNombre],
      ...(d.clienteDocumento ? ([["Documento", d.clienteDocumento]] as [string, string][]) : []),
    ],
  );

  seccion(
    "Vehículo",
    [
      ["Placa", d.vehiculoPlaca],
      ...(d.vehiculoModelo ? ([["Modelo", d.vehiculoModelo]] as [string, string][]) : []),
    ],
  );

  // Monto recibido — bloque destacado
  doc.setDrawColor(...BORDE);
  doc.setLineWidth(0.4);
  doc.roundedRect(margen, y, ancho - margen * 2, 24, 3, 3, "S");
  doc.setTextColor(...GRIS);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("MONTO RECIBIDO", margen + 5, y + 8);
  doc.setTextColor(...GRAFITO);
  doc.setFontSize(18);
  doc.text(soles.format(d.monto), margen + 5, y + 18);
  doc.setTextColor(...COBRE);
  doc.setFontSize(10);
  doc.text(LABEL_METODO[d.metodo], ancho - margen - 5, y + 15, { align: "right" });
  y += 32;

  if (d.saldoPendiente != null) {
    seccion("Saldo del contrato", [["Pendiente", soles.format(d.saldoPendiente)]]);
  }

  if (d.observaciones) {
    doc.setTextColor(...GRIS);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("OBSERVACIONES", margen, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...GRAFITO);
    const lineas = doc.splitTextToSize(d.observaciones, ancho - margen * 2);
    doc.text(lineas, margen, y);
    y += lineas.length * 4.5 + 4;
  }

  if (d.recaudador) {
    doc.setTextColor(...GRIS);
    doc.setFontSize(8);
    doc.text(`Recibido por: ${d.recaudador}`, margen, y);
    y += 6;
  }

  // Pie — si observaciones largas empujaron `y` más abajo de lo normal,
  // el pie baja con el contenido en vez de superponerse (comprobante.ts
  // no pagina: es un recibo de una sola cara en A5).
  const alturaPagina = doc.internal.pageSize.getHeight();
  const lineaPie = Math.max(alturaPagina - 16, y + 6);
  doc.setDrawColor(...BORDE);
  doc.line(margen, lineaPie, ancho - margen, lineaPie);
  doc.setTextColor(...GRIS);
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text("Gracias por su preferencia — Waly Motors", margen, lineaPie + 6);
  doc.text("Comprobante generado digitalmente.", margen, lineaPie + 10.5);

  return doc;
}

export type ResultadoComprobante = "compartido" | "descargado" | "cancelado";

/**
 * Intenta adjuntar el PDF al panel nativo de compartir (el usuario elige
 * WhatsApp ahí mismo, igual que compartir una foto). Si el navegador no
 * soporta compartir archivos, descarga el PDF y abre un chat de WhatsApp
 * con un mensaje pre-redactado para que se adjunte manualmente.
 */
export async function compartirComprobante(
  doc: jsPDF,
  nombreArchivo: string,
  telefono: string | null,
  mensaje: string,
): Promise<ResultadoComprobante> {
  const archivo = new File([doc.output("blob")], nombreArchivo, { type: "application/pdf" });

  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const soportaShare =
    !!nav &&
    typeof nav.share === "function" &&
    typeof nav.canShare === "function" &&
    nav.canShare({ files: [archivo] });

  if (soportaShare && nav) {
    try {
      await nav.share({ files: [archivo], title: "Comprobante de pago", text: mensaje });
      return "compartido";
    } catch (err) {
      // El usuario cerró el panel de compartir: no forzar descarga de todos modos.
      if (err instanceof Error && err.name === "AbortError") return "cancelado";
      // Cualquier otro fallo del share nativo cae al respaldo de abajo.
    }
  }

  doc.save(nombreArchivo);
  if (telefono) abrirWhatsApp(telefono, mensaje);
  return "descargado";
}
