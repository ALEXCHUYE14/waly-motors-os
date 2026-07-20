import { jsPDF } from "jspdf";
import { soles, type FrecuenciaPago } from "@/lib/supabase";

// ── Colores de marca en RGB ──────────────────────────────────
const COBRE: [number, number, number] = [201, 123, 61];
const GRAFITO: [number, number, number] = [32, 31, 29];
const GRIS: [number, number, number] = [140, 137, 131];
const BORDE: [number, number, number] = [234, 231, 225];

// ── Identidad fija de EL ARRENDADOR — persona natural, dueño de la flota.
// Tomada del modelo de contrato interno (features/contratos/CONTRATO.pdf):
// no varía entre contratos, por lo que no forma parte de DatosContratoPdf.
const ARRENDADOR_NOMBRE = "WALDIR DIDI YARLEQUE SILVA";
const ARRENDADOR_DNI = "77430371";
const ARRENDADOR_ESTADO_CIVIL = "casado";
const ARRENDADOR_DOMICILIO =
  "Calle Andrés Avelino Cáceres, Asentamiento Humano Lucas Cutivalu, Etapa II Mz. O Lt. 08, distrito de Catacaos, provincia y departamento de Piura";

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

/** Nunca deja pasar `undefined`/`null`/cadena vacía al documento: todo dato
 *  opcional del cliente cae a un texto explícito en vez de imprimir
 *  literalmente "undefined" o dejar un campo en blanco sin explicación. */
function valorSeguro(valor: string | null | undefined, fallback = "No registrado"): string {
  const texto = (valor ?? "").trim();
  return texto.length > 0 ? texto : fallback;
}

/** Valida los datos mínimos indispensables antes de dibujar una sola línea.
 *  Si falta algo crítico se lanza un error legible — el llamador (el hook
 *  de creación de contrato, o la regeneración on-demand en el detalle)
 *  decide cómo mostrarlo, pero el PDF nunca se genera a medias. */
function validarDatosContrato(d: DatosContratoPdf): void {
  const faltantes: string[] = [];
  if (!d.contratoId?.trim()) faltantes.push("identificador del contrato");
  if (!d.clienteNombre?.trim()) faltantes.push("nombre del cliente");
  if (!d.clienteDocumento?.trim()) faltantes.push("documento del cliente");
  if (!d.vehiculoPlaca?.trim()) faltantes.push("placa del vehículo");
  if (!Number.isFinite(d.montoTotal) || d.montoTotal <= 0) faltantes.push("monto total");
  if (!Number.isFinite(d.montoCuota) || d.montoCuota <= 0) faltantes.push("monto por cuota");
  if (!d.fechaInicioIso?.trim()) faltantes.push("fecha de inicio");

  if (faltantes.length > 0) {
    throw new Error(
      `No se pudo generar el contrato en PDF: faltan datos obligatorios (${faltantes.join(", ")}).`,
    );
  }
}

/** Nombre de archivo seguro para la descarga — sin tildes, espacios ni
 *  caracteres que puedan romperse en algún navegador o sistema operativo. */
export function nombreArchivoContrato(d: Pick<DatosContratoPdf, "vehiculoPlaca" | "clienteNombre">): string {
  const normalizar = (t: string) =>
    t
      .normalize("NFD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "");

  const placa = normalizar(valorSeguro(d.vehiculoPlaca, "SINPLACA")) || "SINPLACA";
  const cliente = normalizar(valorSeguro(d.clienteNombre, "cliente")) || "cliente";
  return `Contrato-${placa}-${cliente}.pdf`;
}

export function generarContratoPdf(d: DatosContratoPdf): jsPDF {
  validarDatosContrato(d);

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
      ? "Contrato privado de alquiler de vehículo menor (trimoto)"
      : "Contrato privado de alquiler-venta de vehículo menor (trimoto)",
    margenX,
    22,
  );
  doc.setFontSize(9);
  doc.text(`N° ${d.contratoId.slice(0, 8).toUpperCase()}`, ancho - margenX, 14, { align: "right" });
  doc.text(fecha.format(new Date(d.creadoEnIso)), ancho - margenX, 20, { align: "right" });

  y = 42;

  // ── I. Partes ────────────────────────────────────────────────
  titulo("I. PARTES — EL ARRENDADOR Y EL ARRENDATARIO");
  filaDatos([
    ["Arrendador", ARRENDADOR_NOMBRE],
    ["DNI", ARRENDADOR_DNI],
    ["Estado civil", ARRENDADOR_ESTADO_CIVIL],
    ["Domicilio", ARRENDADOR_DOMICILIO],
    ["Arrendatario", valorSeguro(d.clienteNombre)],
    [d.clienteTipoDocumento, valorSeguro(d.clienteDocumento)],
    ["Dirección", valorSeguro(d.clienteDireccion, "No registrada")],
    ["Teléfono", valorSeguro(d.clienteTelefono)],
  ]);

  // ── II. Vehículo ─────────────────────────────────────────────
  titulo("II. VEHÍCULO OBJETO DEL CONTRATO");
  filaDatos([
    ["Placa", d.vehiculoPlaca],
    ["Modelo", `${valorSeguro(d.vehiculoModelo, "No registrado")} ${d.vehiculoAnio || ""}`.trim()],
    ["N° de chasis", valorSeguro(d.vehiculoChasis, "No registrado")],
    ["Kilometraje al inicio", `${(d.vehiculoKm ?? 0).toLocaleString("es-PE")} km`],
  ]);

  // ── III. Condiciones económicas ──────────────────────────────
  titulo("III. CONDICIONES ECONÓMICAS");
  filaDatos([
    ["Monto total", soles.format(d.montoTotal)],
    ["Cuota inicial", soles.format(d.cuotaInicial || 0)],
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
  const frecLabel = LABEL_FRECUENCIA[d.frecuenciaPago];
  const fechaInicioTexto = fecha.format(new Date(`${d.fechaInicioIso}T12:00:00`));
  const fechaFinTexto = d.fechaFinIso ? fecha.format(new Date(`${d.fechaFinIso}T12:00:00`)) : null;
  const cuotaInicial = d.cuotaInicial || 0;

  parrafo(
    `PRIMERO. EL ARRENDADOR es propietario del vehículo menor (trimoto) de placa ${d.vehiculoPlaca}, modelo ${valorSeguro(d.vehiculoModelo, "no registrado")} ${d.vehiculoAnio || ""}, con número de chasis ${valorSeguro(d.vehiculoChasis, "no registrado")} y kilometraje de ${(d.vehiculoKm ?? 0).toLocaleString("es-PE")} km registrado a la fecha de entrega.`,
  );
  parrafo(
    d.tipo === "alquiler"
      ? `SEGUNDO. Por el presente contrato, EL ARRENDADOR entrega en alquiler el vehículo descrito en la cláusula PRIMERA en favor de EL ARRENDATARIO, por el monto de ${soles.format(d.montoCuota)} de frecuencia ${frecLabel}, contado desde la fecha de la firma del presente documento.`
      : `SEGUNDO. Por el presente contrato, EL ARRENDADOR entrega en alquiler-venta el vehículo descrito en la cláusula PRIMERA en favor de EL ARRENDATARIO, por el monto total de ${soles.format(d.montoTotal)}, pagadero en cuotas de ${soles.format(d.montoCuota)} de frecuencia ${frecLabel}, contado desde la fecha de la firma del presente documento.`,
  );
  parrafo(
    `TERCERO. Las partes acuerdan que el monto pactado será cancelado en efectivo, Yape, Plin o transferencia bancaria, según la frecuencia ${frecLabel} indicada. Los desperfectos, daños, papeletas y sanciones impuestas al vehículo durante la vigencia del contrato serán cancelados en su totalidad por cuenta de EL ARRENDATARIO.`,
  );
  parrafo(
    `CUARTO. Las partes convienen fijar como plazo de referencia ${d.numCuotasEstimadas} cuota(s) de frecuencia ${frecLabel}, computadas a partir del ${fechaInicioTexto}${fechaFinTexto ? ` hasta el ${fechaFinTexto}` : ""}, plazo dentro del cual EL ARRENDATARIO está obligado a pagar la totalidad de lo pactado en la sección III.`,
  );
  parrafo(
    `QUINTO. EL ARRENDADOR entrega el vehículo en la fecha de suscripción de este documento, sin más constancia que las firmas de las partes puestas en él. Esta obligación se verifica con la entrega in situ y las llaves del vehículo.`,
  );
  parrafo(
    `SEXTO. EL ARRENDATARIO se obliga a pagar puntualmente el monto pactado, en la forma, oportunidad y lugar convenidos. En caso de incumplimiento de la cláusula SEGUNDA, se procederá de la siguiente manera: (i) primer incumplimiento, llamada de advertencia verbal; (ii) segundo incumplimiento, llamada de atención por escrito; (iii) tercer incumplimiento, resolución del presente contrato y recuperación del vehículo, sin que ello genere derecho a reclamo alguno por los montos ya entregados.`,
  );
  parrafo(
    `SÉTIMO. Queda establecido que EL ARRENDATARIO es la única persona responsable del cuidado del vehículo y de su entrega en las mismas condiciones en que lo recibió, considerando el desgaste propio del uso y del tiempo transcurrido.`,
  );
  parrafo(
    `OCTAVO. Mientras el vehículo se encuentre bajo el alquiler de EL ARRENDATARIO, éste responderá en forma exclusiva y excluyente por los daños causados, sean propios o de terceras personas.`,
  );
  parrafo(
    `NOVENO. EL ARRENDATARIO está obligado a efectuar por cuenta y costo propio las reparaciones y mantenimientos originados durante el tiempo del alquiler del vehículo.`,
  );
  parrafo(
    `DÉCIMO. EL ARRENDATARIO queda prohibido de introducir mejoras, cambios o alteraciones internas o externas en el vehículo, sin el consentimiento expreso y por escrito de EL ARRENDADOR.`,
  );
  parrafo(
    `DÉCIMO PRIMERO. EL ARRENDATARIO no podrá ceder a terceros el vehículo bajo ningún título, ni subarrendarlo, ni ceder su posición contractual, salvo consentimiento expreso y por escrito de EL ARRENDADOR.`,
  );
  parrafo(
    `DÉCIMO SEGUNDO. El incumplimiento de la obligación establecida en la cláusula SEXTA constituirá causal de resolución del presente contrato, al amparo del artículo 1430° del Código Civil. La resolución se producirá de pleno derecho cuando EL ARRENDADOR comunique verbalmente o por vía notarial a EL ARRENDATARIO que quiere valerse de esta cláusula.`,
  );
  parrafo(
    cuotaInicial > 0
      ? `DÉCIMO TERCERO. En la fecha de suscripción del presente documento, EL ARRENDATARIO entrega a EL ARRENDADOR la suma de ${soles.format(cuotaInicial)} como pago inicial a favor de EL ARRENDADOR.`
      : `DÉCIMO TERCERO. Las partes dejan constancia de que no se ha pactado pago inicial alguno a favor de EL ARRENDADOR en la fecha de suscripción del presente documento.`,
  );
  parrafo(
    `DÉCIMO CUARTO. Para la validez de todas las comunicaciones y notificaciones entre las partes, con motivo de la ejecución de este contrato, ambas señalan como sus respectivos domicilios los indicados en la sección I. El cambio de domicilio de cualquiera de las partes surtirá efecto desde la fecha de comunicación de dicho cambio a la otra parte, por cualquier medio escrito.`,
  );
  parrafo(
    d.tipo === "venta_credito"
      ? `DÉCIMO QUINTO. Una vez completados los pagos pactados en la sección III, EL ARRENDADOR se obliga a transferir la propiedad del vehículo a favor de EL ARRENDATARIO.`
      : `DÉCIMO QUINTO. Al finalizar el plazo del presente contrato, el vehículo debe ser devuelto a EL ARRENDADOR en condiciones normales de uso, considerando el desgaste propio del tiempo transcurrido.`,
  );
  parrafo(
    `DÉCIMO SEXTO. En lo no previsto por las partes en el presente contrato, ambas se someten a lo establecido por las normas del Código Civil y demás normas del sistema jurídico peruano que resulten aplicables. Para efectos del presente contrato, las partes se someten a la jurisdicción de los juzgados de Piura, Perú.`,
  );

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS);
  parrafo(
    `Nota: este documento fue generado automáticamente por Waly Motors OS como resumen de las condiciones acordadas entre las partes, tomando como base el modelo de contrato interno de la empresa. Se recomienda la revisión de un asesor legal para casos que así lo requieran.`,
  );
  doc.setFont("helvetica", "normal");

  // ── V. Firmas ────────────────────────────────────────────────
  titulo("V. FIRMAS");
  verificarEspacio(48);

  const colGap = 10;
  const colAncho = (ancho - margenX * 2 - colGap) / 2;
  const colArrendadorX = margenX;
  const colArrendatarioX = margenX + colAncho + colGap;
  const filaFirmaY = y;
  const altoCaja = 26;

  doc.setDrawColor(...BORDE);
  doc.setLineWidth(0.3);
  doc.rect(colArrendadorX, filaFirmaY, colAncho, altoCaja);
  doc.rect(colArrendatarioX, filaFirmaY, colAncho, altoCaja);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS);
  doc.text("Espacio para firma", colArrendadorX + colAncho / 2, filaFirmaY + altoCaja / 2, {
    align: "center",
  });

  // La firma del arrendatario es la capturada en pantalla durante el
  // registro (paso 4 del wizard) — si por algún motivo no llegó, se deja
  // el mismo recuadro en blanco que EL ARRENDADOR en vez de romper el PDF.
  if (d.firmaBase64) {
    try {
      const margenImg = 2;
      doc.addImage(
        d.firmaBase64,
        "PNG",
        colArrendatarioX + margenImg,
        filaFirmaY + margenImg,
        colAncho - margenImg * 2,
        altoCaja - margenImg * 2,
      );
    } catch {
      doc.text("Firma no disponible", colArrendatarioX + colAncho / 2, filaFirmaY + altoCaja / 2, {
        align: "center",
      });
    }
  } else {
    doc.text("Espacio para firma", colArrendatarioX + colAncho / 2, filaFirmaY + altoCaja / 2, {
      align: "center",
    });
  }

  y = filaFirmaY + altoCaja + 4;
  doc.setDrawColor(...GRAFITO);
  doc.setLineWidth(0.3);
  doc.line(colArrendadorX + 6, y, colArrendadorX + colAncho - 6, y);
  doc.line(colArrendatarioX + 6, y, colArrendatarioX + colAncho - 6, y);
  y += 4.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...GRAFITO);
  doc.text(ARRENDADOR_NOMBRE, colArrendadorX + colAncho / 2, y, { align: "center" });
  doc.text(valorSeguro(d.clienteNombre).toUpperCase(), colArrendatarioX + colAncho / 2, y, { align: "center" });
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRIS);
  doc.text(`DNI N° ${ARRENDADOR_DNI}`, colArrendadorX + colAncho / 2, y, { align: "center" });
  doc.text(
    `${d.clienteTipoDocumento} N° ${valorSeguro(d.clienteDocumento, "—")}`,
    colArrendatarioX + colAncho / 2,
    y,
    { align: "center" },
  );
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...COBRE);
  doc.text("EL ARRENDADOR", colArrendadorX + colAncho / 2, y, { align: "center" });
  doc.text("EL ARRENDATARIO", colArrendatarioX + colAncho / 2, y, { align: "center" });
  y += 9;

  const codigo = codigoVerificacion(`${d.contratoId}|${d.creadoEnIso}|${d.montoTotal}`);
  filaDatos([
    ["Firmado el", d.firmaFechaIso ? fechaHora.format(new Date(d.firmaFechaIso)) : "—"],
    ["Código de verificación", codigo],
  ]);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...GRIS);
  parrafo(
    "La firma de EL ARRENDATARIO corresponde a una firma electrónica simple registrada en el sistema (trazo capturado digitalmente). No constituye una firma digital certificada con validez criptográfica. El espacio de EL ARRENDADOR queda reservado para su firma manuscrita.",
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
