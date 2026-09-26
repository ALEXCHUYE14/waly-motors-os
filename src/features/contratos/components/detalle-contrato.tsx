"use client";

/**
 * WALY MOTORS OS — Detalle de Contrato
 * Barra de progreso financiero (RPC resumen_contrato), acciones de
 * contrato (descargar / enviar por WhatsApp vía enlace firmado de
 * 7 días) e historial de pagos con un menú de acciones por fila
 * (ver evidencia, comprobante de pago, y las mismas acciones de
 * contrato). Botón de finalización (RPC finalizar_contrato, libera
 * la mototaxi).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Banknote,
  Smartphone,
  Landmark,
  BookOpen,
  FileSignature,
  Flag,
  ImageIcon,
  Share2,
  Download,
  MoreVertical,
  Trash2,
  Pencil,
  X,
} from "lucide-react";
import { supabase, soles, type MetodoPago, type FrecuenciaPago } from "@/lib/supabase";
import {
  useFinalizarContrato,
  useEliminarContrato,
  useEditarMontoPago,
  useEliminarPago,
  type MotivoFinalizacion,
} from "@/features/contratos/hooks/use-contratos";
import { generarComprobantePago, compartirComprobante, type ResultadoComprobante } from "@/lib/comprobante";
import { generarContratoPdf } from "@/lib/contrato-pdf";
import { cn, urlFirmada, abrirWhatsApp, cargarAdjuntoGarantia, mensajeError } from "@/lib/utils";
import { WhatsAppIcon } from "@/components/ui/whatsapp-icon";
import { CalendarioPagos } from "@/components/ui/calendario-pagos";

/** `fecha_pago` llega como timestamptz (ej. "2024-01-15T23:40:00+00:00")
 *  — recortar los primeros 10 caracteres tomaría el día en UTC, que
 *  puede ser el día SIGUIENTE al real en hora de Perú para un pago hecho
 *  de noche. Se arma la fecha en hora LOCAL del navegador (igual que
 *  cualquier `toLocaleDateString("es-PE")` ya usado en este archivo). */
function fechaLocalISO(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Tipos ────────────────────────────────────────────────────
interface ResumenContrato {
  contrato_id: string;
  tipo: "alquiler" | "venta_credito";
  estado: "activo" | "vencido" | "finalizado";
  motivo_finalizacion: MotivoFinalizacion | null;
  monto_total: number;
  cuota_inicial: number;
  monto_cuota: number;
  frecuencia_pago: FrecuenciaPago;
  fecha_inicio: string;
  fecha_fin: string | null;
  /** Solo si el total se calculó por tarifa diaria diferenciada (ver
   *  migración 00022) — dato informativo/de auditoría, no participa en
   *  ningún cálculo de saldo o mora (esos siempre salen de `pagos`). */
  duracion_meses: number | null;
  monto_lunes_sabado: number | null;
  monto_domingo: number | null;
  /** Monto migrado del cuaderno al crear el contrato — ya está incluido
   *  en `total_pagado` (se insertó como fila real en `pagos`), este
   *  campo es solo para mostrarlo por separado si hace falta. */
  pagos_previos_acumulados: number;
  /** Misma fórmula exacta que `obtener_clientes_en_mora` (migración
   *  00023) — nunca se recalcula por separado en el frontend, para que
   *  el calendario de pagos y la lista de mora del dashboard jamás
   *  muestren un número distinto para el mismo contrato. */
  proximo_vencimiento: string;
  dias_retraso: number;
  total_pagado: number;
  saldo: number;
  pct_avance: number;
  num_pagos: number;
  ultimo_pago: string | null;
  cliente_nombre: string;
  cliente_documento: string;
  cliente_tipo_documento: "DNI" | "RUC";
  cliente_direccion: string | null;
  cliente_telefono: string | null;
  vehiculo_placa: string;
  vehiculo_modelo: string;
  vehiculo_anio: number;
  vehiculo_chasis: string;
  vehiculo_km: number;
  firma_base64: string | null;
  firma_fecha: string | null;
  documentos_garantia: string[];
  contrato_pdf_url: string | null;
  creado_en: string;
}

interface PagoContrato {
  id: string;
  monto_recibido: number;
  fecha_pago: string;
  metodo_pago: MetodoPago;
  estado: "completado" | "parcial" | "rechazado";
  evidencia_url: string | null;
  observaciones: string | null;
  /** Monto con el que se cobró de verdad en calle antes de la primera
   *  corrección — `null` si el pago nunca se editó (ver migración
   *  00027). Se muestra aparte de `observaciones` para no romper la
   *  etiqueta de cuota inicial / pago migrado que ya vive ahí. */
  monto_original: number | null;
  motivo_edicion: string | null;
  perfiles: { nombre: string } | null;
}

const ICONO_METODO: Record<MetodoPago, React.ReactNode> = {
  yape: <Smartphone className="h-4 w-4" />,
  plin: <Smartphone className="h-4 w-4" />,
  efectivo: <Banknote className="h-4 w-4" />,
  transferencia: <Landmark className="h-4 w-4" />,
  abono_adicional: <BookOpen className="h-4 w-4" />,
};

const LABEL_METODO: Record<MetodoPago, string> = {
  yape: "Yape",
  plin: "Plin",
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  abono_adicional: "Abono adicional",
};

const fechaHora = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const MENSAJE_COMPROBANTE: Record<ResultadoComprobante, string> = {
  compartido: "Comprobante enviado.",
  descargado: "Comprobante descargado — ábrelo en WhatsApp para adjuntarlo.",
  cancelado: "Envío cancelado.",
};

/** El enlace del contrato dura más que el de un recibo puntual: es un
 *  documento que el cliente puede querer reabrir más adelante. */
const SEGUNDOS_ENLACE_CONTRATO = 60 * 60 * 24 * 7;

// ── Hooks ────────────────────────────────────────────────────
function useResumen(contratoId: string) {
  return useQuery({
    queryKey: ["resumen-contrato", contratoId],
    queryFn: async (): Promise<ResumenContrato> => {
      const { data, error } = await supabase.rpc("resumen_contrato", {
        p_contrato_id: contratoId,
      });
      if (error) throw error;
      return data as ResumenContrato;
    },
  });
}

function usePagosContrato(contratoId: string) {
  return useQuery({
    queryKey: ["pagos-contrato", contratoId],
    queryFn: async (): Promise<PagoContrato[]> => {
      const { data, error } = await supabase
        .from("pagos")
        .select(
          "id, monto_recibido, fecha_pago, metodo_pago, estado, evidencia_url, observaciones, monto_original, motivo_edicion, perfiles:recaudador_id (nombre)",
        )
        .eq("contrato_id", contratoId)
        .order("fecha_pago", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PagoContrato[];
    },
  });
}

// ═════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═════════════════════════════════════════════════════════════
export default function DetalleContrato({ contratoId }: { contratoId: string }) {
  const router = useRouter();
  const resumen = useResumen(contratoId);
  const pagos = usePagosContrato(contratoId);
  const finalizar = useFinalizarContrato();
  const eliminar = useEliminarContrato();
  const editarMonto = useEditarMontoPago();
  const eliminarPago = useEliminarPago();

  const [confirmarFin, setConfirmarFin] = useState(false);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [evidenciaAbierta, setEvidenciaAbierta] = useState<string | null>(null);
  const [errorFinalizar, setErrorFinalizar] = useState<string | null>(null);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);
  const [generandoContrato, setGenerandoContrato] = useState(false);
  const [estadoComprobante, setEstadoComprobante] = useState<{ id: string; resultado: ResultadoComprobante } | null>(null);
  const [menuPago, setMenuPago] = useState<PagoContrato | null>(null);
  const [avisoContrato, setAvisoContrato] = useState<string | null>(null);

  // Corrección de monto de un pago ya registrado (ver migración 00027):
  // evita eliminar el contrato entero por un solo número mal tipeado.
  const [pagoAEditar, setPagoAEditar] = useState<PagoContrato | null>(null);
  const [montoCorregido, setMontoCorregido] = useState("");
  const [motivoCorreccion, setMotivoCorreccion] = useState("");
  const [errorEditarPago, setErrorEditarPago] = useState<string | null>(null);

  // Eliminar un pago registrado por error (ver migración 00031): para
  // cuando el pago entero no debió existir, no solo su monto.
  const [pagoAEliminar, setPagoAEliminar] = useState<PagoContrato | null>(null);
  const [errorEliminarPago, setErrorEliminarPago] = useState<string | null>(null);

  const r = resumen.data;
  // Mismo criterio exacto que `resumen_contrato` / `obtener_clientes_en_mora`
  // (migración 00023): solo pagos 'completado' o 'parcial' cuentan como
  // "día pagado". Sin este filtro, un pago 'rechazado' (con fecha_pago en
  // un día que el backend SÍ considera en mora, porque nunca lo suma al
  // cálculo de `proximo_vencimiento`) pintaría ese día de verde en el
  // calendario mientras el backend lo sigue tratando como impago —
  // incluye tanto cobros en vivo como "Abono adicional" (pago del
  // cuaderno), que insertan la misma tabla `pagos` con la fecha elegida
  // por el asesor (ver registrar_pago, migración 00021).
  const fechasConPago = new Set(
    (pagos.data ?? [])
      .filter((p) => p.estado === "completado" || p.estado === "parcial")
      .map((p) => fechaLocalISO(p.fecha_pago)),
  );

  function confirmarFinalizacion(motivo: MotivoFinalizacion) {
    setErrorFinalizar(null);
    finalizar.mutate(
      { contratoId, motivo },
      {
        onSuccess: () => {
          setConfirmarFin(false);
          void resumen.refetch();
        },
        onError: (err) => {
          setErrorFinalizar(mensajeError(err, "No se pudo finalizar el contrato. Intenta de nuevo."));
        },
      },
    );
  }

  function confirmarEliminarContrato() {
    setErrorEliminar(null);
    eliminar.mutate(contratoId, {
      onSuccess: async ({ fotosEvidencia, documentosGarantia, contratoPdfUrl }) => {
        // Best-effort: la fila ya se borró en la base de datos — si esto
        // falla, solo quedan archivos huérfanos en Storage, nunca vuelve
        // a bloquear ni a mostrar el contrato ya eliminado.
        try {
          if (fotosEvidencia.length > 0) {
            await supabase.storage.from("evidencias").remove(fotosEvidencia);
          }
          if (documentosGarantia.length > 0) {
            await supabase.storage.from("garantias").remove(documentosGarantia);
          }
          if (contratoPdfUrl) {
            await supabase.storage.from("contratos").remove([contratoPdfUrl]);
          }
        } catch {
          // No propagar: el contrato ya se eliminó correctamente.
        }
        router.push("/contratos");
      },
      onError: (err) => {
        setErrorEliminar(mensajeError(err, "No se pudo eliminar el contrato. Intenta de nuevo."));
      },
    });
  }

  async function verEvidencia(ruta: string) {
    const url = await urlFirmada("evidencias", ruta);
    if (url) setEvidenciaAbierta(url);
  }

  /** Devuelve la ruta interna del PDF del contrato, generándolo y
   *  subiéndolo la primera vez si todavía no existe (contratos creados
   *  antes de esta función, o si la subida original falló). Lanza un
   *  error con el motivo real (validación, storage, RLS, etc.) — nunca
   *  lo esconde detrás de un aviso genérico, para poder diagnosticarlo. */
  async function asegurarRutaContratoPdf(): Promise<string> {
    if (!r) throw new Error("El contrato todavía no terminó de cargar. Espera un momento e intenta de nuevo.");
    if (r.contrato_pdf_url) return r.contrato_pdf_url;

    const numCuotas = r.monto_cuota > 0 ? Math.ceil((r.monto_total - r.cuota_inicial) / r.monto_cuota) : 0;
    // Estos ya están subidos a Supabase (contrato existente) — hay que
    // bajarlos del bucket `garantias` para poder incrustarlos como imagen.
    const adjuntos = await Promise.all(r.documentos_garantia.map(cargarAdjuntoGarantia));
    const pdf = await generarContratoPdf({
      contratoId: r.contrato_id,
      tipo: r.tipo,
      creadoEnIso: r.creado_en,
      clienteNombre: r.cliente_nombre,
      clienteTipoDocumento: r.cliente_tipo_documento,
      clienteDocumento: r.cliente_documento,
      clienteDireccion: r.cliente_direccion,
      clienteTelefono: r.cliente_telefono,
      vehiculoPlaca: r.vehiculo_placa,
      vehiculoModelo: r.vehiculo_modelo,
      vehiculoAnio: r.vehiculo_anio,
      vehiculoChasis: r.vehiculo_chasis,
      vehiculoKm: r.vehiculo_km,
      montoTotal: r.monto_total,
      cuotaInicial: r.cuota_inicial,
      montoCuota: r.monto_cuota,
      frecuenciaPago: r.frecuencia_pago,
      numCuotasEstimadas: numCuotas,
      fechaInicioIso: r.fecha_inicio,
      fechaFinIso: r.fecha_fin,
      firmaBase64: r.firma_base64,
      firmaFechaIso: r.firma_fecha,
      documentosGarantia: adjuntos,
    });

    const ruta = `${r.contrato_id}/contrato.pdf`;
    const archivo = new File([pdf.output("blob")], "contrato.pdf", { type: "application/pdf" });
    const { error } = await supabase.storage
      .from("contratos")
      .upload(ruta, archivo, { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(`No se pudo subir el PDF al almacenamiento: ${error.message}`);

    const { error: errUpdate } = await supabase
      .from("contratos")
      .update({ contrato_pdf_url: ruta })
      .eq("id", r.contrato_id);
    if (errUpdate) throw new Error(`No se pudo guardar la ruta del PDF: ${errUpdate.message}`);

    void resumen.refetch();
    return ruta;
  }

  async function descargarContrato() {
    setGenerandoContrato(true);
    setAvisoContrato(null);
    try {
      const ruta = await asegurarRutaContratoPdf();
      const url = await urlFirmada("contratos", ruta, SEGUNDOS_ENLACE_CONTRATO);
      if (!url) {
        setAvisoContrato("No se pudo generar el enlace de descarga del contrato.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setAvisoContrato(mensajeError(err, "No se pudo generar el contrato. Intenta de nuevo."));
    } finally {
      setGenerandoContrato(false);
    }
  }

  async function enviarContratoWhatsApp() {
    if (!r) return;
    setGenerandoContrato(true);
    setAvisoContrato(null);
    try {
      const ruta = await asegurarRutaContratoPdf();
      const url = await urlFirmada("contratos", ruta, SEGUNDOS_ENLACE_CONTRATO);
      if (!url) {
        setAvisoContrato("No se pudo generar el enlace del contrato.");
        return;
      }
      if (!r.cliente_telefono) {
        setAvisoContrato("El cliente no tiene teléfono registrado.");
        return;
      }
      const primerNombre = r.cliente_nombre.split(" ")[0];
      const mensaje =
        `Hola ${primerNombre}, te compartimos el contrato de tu mototaxi placa ${r.vehiculo_placa} con Wally Motors. ` +
        `Puedes revisarlo aquí (enlace válido por 7 días): ${url}`;
      abrirWhatsApp(r.cliente_telefono, mensaje);
    } catch (err) {
      setAvisoContrato(mensajeError(err, "No se pudo generar el contrato. Intenta de nuevo."));
    } finally {
      setGenerandoContrato(false);
    }
  }

  async function enviarComprobantePago(p: PagoContrato) {
    if (!r) return;
    setEstadoComprobante(null);
    const doc = await generarComprobantePago({
      folio: p.id.slice(0, 8).toUpperCase(),
      fechaIso: p.fecha_pago,
      clienteNombre: r.cliente_nombre,
      clienteDocumento: r.cliente_documento,
      vehiculoPlaca: r.vehiculo_placa,
      vehiculoModelo: r.vehiculo_modelo,
      monto: p.monto_recibido,
      metodo: p.metodo_pago,
      observaciones: p.observaciones,
      saldoPendiente: r.saldo,
      recaudador: p.perfiles?.nombre ?? null,
    });
    const primerNombre = r.cliente_nombre.split(" ")[0];
    const mensaje = `Hola ${primerNombre}, aquí tu comprobante de pago de ${soles.format(p.monto_recibido)} — Wally Motors. ¡Gracias por tu preferencia!`;
    const resultado = await compartirComprobante(
      doc,
      `comprobante-${r.vehiculo_placa}-${p.id.slice(0, 6)}.pdf`,
      r.cliente_telefono,
      mensaje,
    );
    setEstadoComprobante({ id: p.id, resultado });
    setMenuPago(null);
  }

  function abrirEdicionMonto(p: PagoContrato) {
    setPagoAEditar(p);
    setMontoCorregido(String(p.monto_recibido));
    setMotivoCorreccion("");
    setErrorEditarPago(null);
    setMenuPago(null);
  }

  function confirmarEdicionMonto() {
    if (!pagoAEditar) return;
    const monto = Number.parseFloat(montoCorregido);
    if (!Number.isFinite(monto) || monto <= 0) {
      setErrorEditarPago("Ingresa un monto válido, mayor a cero.");
      return;
    }
    setErrorEditarPago(null);
    editarMonto.mutate(
      { contratoId, pagoId: pagoAEditar.id, monto, motivo: motivoCorreccion },
      {
        onSuccess: () => setPagoAEditar(null),
        onError: (err) => {
          setErrorEditarPago(mensajeError(err, "No se pudo corregir el monto. Intenta de nuevo."));
        },
      },
    );
  }

  function abrirEliminarPago(p: PagoContrato) {
    setPagoAEliminar(p);
    setErrorEliminarPago(null);
    setMenuPago(null);
  }

  function confirmarEliminarPago() {
    if (!pagoAEliminar) return;
    setErrorEliminarPago(null);
    eliminarPago.mutate(
      { contratoId, pagoId: pagoAEliminar.id },
      {
        onSuccess: async (pagoBorrado) => {
          setPagoAEliminar(null);
          // Best-effort, igual que al eliminar un contrato entero: la fila
          // ya se borró en la base de datos — si esto falla, solo queda
          // una foto huérfana en Storage, nunca vuelve a bloquear ni a
          // mostrar el pago ya eliminado.
          if (pagoBorrado?.evidencia_url) {
            try {
              await supabase.storage.from("evidencias").remove([pagoBorrado.evidencia_url]);
            } catch {
              // No propagar: el pago ya se eliminó correctamente.
            }
          }
        },
        onError: (err) => {
          setErrorEliminarPago(mensajeError(err, "No se pudo eliminar el pago. Intenta de nuevo."));
        },
      },
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-black uppercase tracking-tight text-grafito">
          <FileSignature className="h-5 w-5 text-cobre" /> Contrato
        </h1>
        <div className="flex items-center gap-2">
          {r && (
            <span
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-bold",
                r.estado === "activo"
                  ? "bg-emerald-500/15 text-emerald-600"
                  : r.estado === "vencido"
                    ? "bg-oxido/15 text-oxido"
                    : "bg-grafito/10 text-grafito/60",
              )}
            >
              {r.estado === "activo"
                ? "Activo"
                : r.estado === "vencido"
                  ? "Vencido"
                  : r.motivo_finalizacion === "incumplimiento"
                    ? "Finalizado — incumplimiento"
                    : "Finalizado"}
            </span>
          )}
          {/* Solo si no está finalizado — el registro histórico no se
              edita (ver useEditarContrato / migración 00023). */}
          {r && r.estado !== "finalizado" && (
            <button
              type="button"
              onClick={() => router.push(`/contratos/${contratoId}/editar`)}
              aria-label="Editar contrato"
              title="Editar contrato"
              className="grid h-8 w-8 place-items-center rounded-lg text-grafito/40 hover:bg-fondo"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* ── Acciones del contrato ── */}
      {r && (
        <section aria-label="Acciones del contrato" className="space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void descargarContrato()}
              disabled={generandoContrato}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-borde bg-tarjeta py-3 text-sm font-bold text-grafito active:scale-[0.98] disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Descargar
            </button>
            <button
              type="button"
              onClick={() => void enviarContratoWhatsApp()}
              disabled={generandoContrato}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-whatsapp/30 bg-whatsapp/5 py-3 text-sm font-bold text-whatsapp active:scale-[0.98] disabled:opacity-50"
            >
              <WhatsAppIcon className="h-4 w-4" /> {generandoContrato ? "Generando…" : "Enviar por WhatsApp"}
            </button>
          </div>
          {avisoContrato && <p className="text-xs text-grafito/50">{avisoContrato}</p>}
        </section>
      )}

      {/* ── Progreso financiero ── */}
      {resumen.isLoading ? (
        <div className="h-36 animate-pulse rounded-2xl bg-borde/60" />
      ) : r ? (
        <section
          aria-label="Progreso financiero"
          className="space-y-3 rounded-2xl border border-borde bg-tarjeta p-4 shadow-card"
        >
          <div>
            <p className="text-sm font-semibold text-grafito">{r.cliente_nombre}</p>
            <p className="text-xs text-grafito/50">
              Doc. <span className="font-mono">{r.cliente_documento}</span> · Placa{" "}
              <span className="font-mono font-bold">{r.vehiculo_placa}</span>
            </p>
          </div>

          <div className="flex items-baseline justify-between">
            <p className="text-3xl font-black tabular-nums text-grafito">{r.pct_avance}%</p>
            <p className="text-xs font-semibold uppercase tracking-widest text-grafito/40">
              {r.tipo === "alquiler" ? "Alquiler" : "Venta a crédito"} · {r.num_pagos} pagos
            </p>
          </div>

          <div
            role="progressbar"
            aria-valuenow={r.pct_avance}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-3 overflow-hidden rounded-full bg-borde"
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${r.pct_avance}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 24 }}
              className={cn(
                "h-full rounded-full",
                r.pct_avance >= 100 ? "bg-emerald-500" : "bg-amarillo",
              )}
            />
          </div>

          <dl className="grid grid-cols-3 gap-2 text-center text-sm">
            {(
              [
                ["Pagado", soles.format(r.total_pagado), ""],
                ["Saldo", soles.format(r.saldo), r.saldo > 0 ? "text-oxido" : "text-emerald-500"],
                ["Total", soles.format(r.monto_total), ""],
              ] as const
            ).map(([k, v, extra]) => (
              <div key={k} className="rounded-xl bg-fondo p-2">
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-grafito/40">{k}</dt>
                <dd className={cn("font-black tabular-nums text-grafito", extra)}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <p className="rounded-2xl bg-oxido/10 p-4 text-sm text-oxido">
          No se pudo cargar el contrato.
        </p>
      )}

      {/* ── Calendario de pagos ── */}
      {r && (
        <section aria-label="Calendario de pagos" className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest text-grafito/40">
            Calendario de pagos
          </h2>
          <CalendarioPagos
            fechasConPago={fechasConPago}
            inicioMora={r.dias_retraso > 0 ? r.proximo_vencimiento : null}
          />
          {r.dias_retraso > 0 && (
            <p className="text-xs font-medium text-oxido">
              {r.dias_retraso} {r.dias_retraso === 1 ? "día" : "días"} de retraso desde el{" "}
              {new Date(`${r.proximo_vencimiento}T12:00:00`).toLocaleDateString("es-PE")}.
            </p>
          )}
        </section>
      )}

      {/* ── Historial de pagos ── */}
      <section aria-label="Historial de pagos" className="space-y-2">
        <h2 className="text-sm font-black uppercase tracking-widest text-grafito/40">
          Historial de pagos
        </h2>

        {pagos.isLoading &&
          [0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-borde/60" />
          ))}

        {pagos.data?.map((p) => (
          <div key={p.id} className="rounded-2xl border border-borde bg-tarjeta p-3 shadow-card">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                  p.estado === "completado"
                    ? "bg-emerald-500/15 text-emerald-500"
                    : p.estado === "parcial"
                      ? "bg-amarillo/20 text-grafito"
                      : "bg-oxido/15 text-oxido",
                )}
              >
                {ICONO_METODO[p.metodo_pago]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-black tabular-nums text-grafito">{soles.format(p.monto_recibido)}</p>
                <p className="truncate text-xs text-grafito/50">
                  {fechaHora.format(new Date(p.fecha_pago))} · {LABEL_METODO[p.metodo_pago]}
                  {p.perfiles?.nombre && ` · ${p.perfiles.nombre}`}
                  {p.estado === "parcial" && " · parcial"}
                </p>
                {/* Separa visualmente la cuota inicial (y los pagos
                    previos migrados del cuaderno) de las cuotas
                    regulares del cronograma financiado — ambas RPC ya
                    marcan estos pagos con su propio texto en
                    `observaciones`; una cuota regular no trae ninguno. */}
                {p.observaciones && (
                  <span className="mt-1 inline-block rounded-md bg-cobre/10 px-1.5 py-0.5 text-[10px] font-semibold text-cobre">
                    {p.observaciones}
                  </span>
                )}
                {/* Aparte de `observaciones` a propósito (ver migración
                    00027): así nunca se mezcla con la etiqueta de cuota
                    inicial / pago migrado de arriba. */}
                {p.monto_original !== null && (
                  <p className="mt-1 text-[11px] font-medium text-oxido">
                    Monto corregido — antes {soles.format(p.monto_original)}
                    {p.motivo_edicion && ` · ${p.motivo_edicion}`}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setMenuPago(p)}
                aria-label="Más acciones para este pago"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-grafito/50 hover:bg-fondo"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
            {estadoComprobante?.id === p.id && (
              <p className="mt-2 text-[11px] text-grafito/50">
                {MENSAJE_COMPROBANTE[estadoComprobante.resultado]}
              </p>
            )}
          </div>
        ))}

        {pagos.isSuccess && pagos.data.length === 0 && (
          <p className="rounded-2xl border border-dashed border-borde p-4 text-center text-sm text-grafito/50">
            Aún no hay pagos registrados en este contrato.
          </p>
        )}
      </section>

      {/* ── Finalizar contrato ── */}
      {r?.estado === "activo" && (
        <section className="space-y-2">
          {!confirmarFin ? (
            <button
              type="button"
              onClick={() => setConfirmarFin(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-oxido/40 py-3.5 text-sm font-bold text-oxido"
            >
              <Flag className="h-4 w-4" /> Finalizar contrato
            </button>
          ) : r.tipo === "venta_credito" && r.saldo > 0 ? (
            // Venta a crédito sin terminar de pagar: hay que preguntar el
            // motivo, porque el destino de la mototaxi depende de él — si
            // no se pregunta, un incumplimiento (cliente se queda sin
            // pagar y se le recupera el vehículo) queda indistinguible de
            // una venta exitosa, y la moto se pierde como "vendida" para
            // siempre aunque nunca se cobró.
            <div className="space-y-3 rounded-2xl border border-oxido/30 bg-oxido/5 p-4">
              <p className="text-sm text-grafito">
                Es una venta a crédito con un saldo pendiente de{" "}
                <span className="font-black">{soles.format(r.saldo)}</span>. Elige el motivo del cierre:
              </p>
              {errorFinalizar && (
                <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">
                  {errorFinalizar}
                </p>
              )}
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={finalizar.isPending}
                  onClick={() => confirmarFinalizacion("completado")}
                  className="w-full rounded-xl border border-borde py-3 text-sm font-semibold text-grafito disabled:opacity-60"
                >
                  El cliente completó el pago (queda vendida)
                </button>
                <button
                  type="button"
                  disabled={finalizar.isPending}
                  onClick={() => confirmarFinalizacion("incumplimiento")}
                  className="w-full rounded-xl bg-oxido py-3 text-sm font-bold text-white disabled:opacity-60"
                >
                  {finalizar.isPending ? "Finalizando…" : "Incumplimiento — recuperar mototaxi"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmarFin(false)}
                  className="w-full rounded-xl border border-borde py-3 text-sm font-semibold text-grafito"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-2xl border border-oxido/30 bg-oxido/5 p-4">
              <p className="text-sm text-grafito">
                {r.tipo === "alquiler"
                  ? "Se cerrará el contrato y la mototaxi volverá a estado disponible."
                  : "Se cerrará el contrato de venta a crédito. La mototaxi permanecerá como vendida."}
              </p>
              {errorFinalizar && (
                <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">
                  {errorFinalizar}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmarFin(false)}
                  className="flex-1 rounded-xl border border-borde py-3 text-sm font-semibold text-grafito"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={finalizar.isPending}
                  onClick={() => confirmarFinalizacion("completado")}
                  className="flex-1 rounded-xl bg-oxido py-3 text-sm font-bold text-white disabled:opacity-60"
                >
                  {finalizar.isPending ? "Finalizando…" : "Sí, finalizar"}
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => router.push("/pagos/nuevo")}
            className="w-full rounded-xl bg-amarillo py-3.5 font-bold text-grafito active:scale-[0.98]"
          >
            Registrar un cobro
          </button>
        </section>
      )}

      {/* ── Eliminar contrato (solo ya finalizados — limpieza) ── */}
      {r?.estado === "finalizado" && (
        <section className="space-y-2">
          {!confirmarEliminar ? (
            <button
              type="button"
              onClick={() => setConfirmarEliminar(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-oxido/40 py-3.5 text-sm font-bold text-oxido"
            >
              <Trash2 className="h-4 w-4" /> Eliminar contrato
            </button>
          ) : (
            <div className="space-y-3 rounded-2xl border border-oxido/30 bg-oxido/5 p-4">
              <p className="text-sm text-grafito">
                Se borrará el contrato y su historial de pagos por completo. Esta acción no se puede
                deshacer.
              </p>
              {errorEliminar && (
                <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">
                  {errorEliminar}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmarEliminar(false)}
                  className="flex-1 rounded-xl border border-borde py-3 text-sm font-semibold text-grafito"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={eliminar.isPending}
                  onClick={confirmarEliminarContrato}
                  className="flex-1 rounded-xl bg-oxido py-3 text-sm font-bold text-white disabled:opacity-60"
                >
                  {eliminar.isPending ? "Eliminando…" : "Sí, eliminar"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Menú de acciones por pago ── */}
      <AnimatePresence>
        {menuPago && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] grid place-items-end bg-grafito/40 backdrop-blur-sm sm:place-items-center"
            onClick={() => setMenuPago(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Acciones del pago"
          >
            <motion.div
              initial={{ y: 48 }}
              animate={{ y: 0 }}
              exit={{ y: 48 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md space-y-1 rounded-t-3xl bg-tarjeta p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-2xl sm:rounded-3xl"
            >
              <div className="flex items-center justify-between px-2 py-2">
                <p className="font-black uppercase tracking-wide text-grafito">
                  {soles.format(menuPago.monto_recibido)}
                </p>
                <button
                  type="button"
                  onClick={() => setMenuPago(null)}
                  aria-label="Cerrar"
                  className="rounded-lg p-1.5 text-grafito/40 hover:bg-fondo"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => abrirEdicionMonto(menuPago)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-grafito hover:bg-fondo"
              >
                <Pencil className="h-4 w-4 text-grafito/50" /> Corregir monto del pago
              </button>
              <button
                type="button"
                onClick={() => abrirEliminarPago(menuPago)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-oxido hover:bg-oxido/5"
              >
                <Trash2 className="h-4 w-4" /> Eliminar pago (registrado por error)
              </button>
              {menuPago.evidencia_url && (
                <button
                  type="button"
                  onClick={() => {
                    void verEvidencia(menuPago.evidencia_url as string);
                    setMenuPago(null);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-grafito hover:bg-fondo"
                >
                  <ImageIcon className="h-4 w-4 text-grafito/50" /> Ver comprobante del pago
                </button>
              )}
              <button
                type="button"
                onClick={() => void enviarComprobantePago(menuPago)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-grafito hover:bg-fondo"
              >
                <Share2 className="h-4 w-4 text-grafito/50" /> Enviar comprobante por WhatsApp
              </button>
              <button
                type="button"
                onClick={() => {
                  void descargarContrato();
                  setMenuPago(null);
                }}
                disabled={generandoContrato}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-grafito hover:bg-fondo disabled:opacity-50"
              >
                <Download className="h-4 w-4 text-grafito/50" /> Descargar contrato
              </button>
              <button
                type="button"
                onClick={() => {
                  void enviarContratoWhatsApp();
                  setMenuPago(null);
                }}
                disabled={generandoContrato}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-grafito hover:bg-fondo disabled:opacity-50"
              >
                <WhatsAppIcon className="h-4 w-4 text-whatsapp" /> Enviar contrato por WhatsApp
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Corregir monto de un pago (sin eliminar el contrato) ── */}
      <AnimatePresence>
        {pagoAEditar && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] grid place-items-end bg-grafito/40 backdrop-blur-sm sm:place-items-center"
            onClick={() => !editarMonto.isPending && setPagoAEditar(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Corregir monto del pago"
          >
            <motion.div
              initial={{ y: 48 }}
              animate={{ y: 0 }}
              exit={{ y: 48 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md space-y-4 rounded-t-3xl bg-tarjeta p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl sm:rounded-3xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-black uppercase tracking-wide text-grafito">Corregir monto</h2>
                <button
                  type="button"
                  onClick={() => setPagoAEditar(null)}
                  disabled={editarMonto.isPending}
                  aria-label="Cerrar"
                  className="rounded-lg p-1.5 text-grafito/40 hover:bg-fondo disabled:opacity-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <p className="text-xs text-grafito/50">
                Pago del {fechaHora.format(new Date(pagoAEditar.fecha_pago))} vía{" "}
                {LABEL_METODO[pagoAEditar.metodo_pago]}. Monto actual:{" "}
                <span className="font-bold text-grafito">{soles.format(pagoAEditar.monto_recibido)}</span>. Esto
                solo corrige el monto — la fecha y el método de pago quedan igual.
              </p>

              <div>
                <label
                  htmlFor="monto-corregido"
                  className="text-[11px] font-semibold uppercase tracking-widest text-grafito/40"
                >
                  Monto correcto (S/.)
                </label>
                <input
                  id="monto-corregido"
                  type="number"
                  inputMode="decimal"
                  step="0.10"
                  min="0"
                  autoFocus
                  value={montoCorregido}
                  onChange={(e) => setMontoCorregido(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-borde bg-fondo px-4 py-3.5 text-2xl font-black tabular-nums text-grafito focus-visible:outline-2 focus-visible:outline-amarillo"
                />
              </div>

              <div>
                <label
                  htmlFor="motivo-correccion"
                  className="text-[11px] font-semibold uppercase tracking-widest text-grafito/40"
                >
                  Motivo (opcional)
                </label>
                <input
                  id="motivo-correccion"
                  type="text"
                  value={motivoCorreccion}
                  onChange={(e) => setMotivoCorreccion(e.target.value)}
                  placeholder="Ej. Se tipeó de más por error"
                  className="mt-1 w-full rounded-2xl border border-borde bg-fondo px-4 py-3 text-sm text-grafito focus-visible:outline-2 focus-visible:outline-amarillo"
                />
              </div>

              {errorEditarPago && (
                <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">{errorEditarPago}</p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPagoAEditar(null)}
                  disabled={editarMonto.isPending}
                  className="flex-1 rounded-xl border border-borde py-3 text-sm font-semibold text-grafito disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarEdicionMonto}
                  disabled={editarMonto.isPending}
                  className="flex-1 rounded-xl bg-amarillo py-3 text-sm font-bold text-grafito disabled:opacity-60"
                >
                  {editarMonto.isPending ? "Guardando…" : "Guardar corrección"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Eliminar un pago (registrado por error) ── */}
      <AnimatePresence>
        {pagoAEliminar && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] grid place-items-end bg-grafito/40 backdrop-blur-sm sm:place-items-center"
            onClick={() => !eliminarPago.isPending && setPagoAEliminar(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Eliminar pago"
          >
            <motion.div
              initial={{ y: 48 }}
              animate={{ y: 0 }}
              exit={{ y: 48 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md space-y-4 rounded-t-3xl bg-tarjeta p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl sm:rounded-3xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-black uppercase tracking-wide text-grafito">Eliminar pago</h2>
                <button
                  type="button"
                  onClick={() => setPagoAEliminar(null)}
                  disabled={eliminarPago.isPending}
                  aria-label="Cerrar"
                  className="rounded-lg p-1.5 text-grafito/40 hover:bg-fondo disabled:opacity-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <p className="text-sm text-grafito">
                Se eliminará por completo el pago de{" "}
                <span className="font-black">{soles.format(pagoAEliminar.monto_recibido)}</span> del{" "}
                {fechaHora.format(new Date(pagoAEliminar.fecha_pago))} vía{" "}
                {LABEL_METODO[pagoAEliminar.metodo_pago]}. El saldo, el % de avance y la mora del contrato se
                recalculan solos al quitarlo. Esta acción no se puede deshacer — úsala solo cuando el pago no
                debió registrarse (si solo el monto está mal, usa &quot;Corregir monto del pago&quot; en vez de
                esto).
              </p>

              {errorEliminarPago && (
                <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">{errorEliminarPago}</p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPagoAEliminar(null)}
                  disabled={eliminarPago.isPending}
                  className="flex-1 rounded-xl border border-borde py-3 text-sm font-semibold text-grafito disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarEliminarPago}
                  disabled={eliminarPago.isPending}
                  className="flex-1 rounded-xl bg-oxido py-3 text-sm font-bold text-white disabled:opacity-60"
                >
                  {eliminarPago.isPending ? "Eliminando…" : "Sí, eliminar pago"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Lightbox de evidencia ── */}
      <AnimatePresence>
        {evidenciaAbierta && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label="Comprobante de pago"
            onClick={() => setEvidenciaAbierta(null)}
            className="fixed inset-0 z-[60] grid place-items-center bg-grafito/80 p-4 backdrop-blur-sm"
          >
            <button
              type="button"
              aria-label="Cerrar"
              className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-white"
            >
              <X className="h-5 w-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={evidenciaAbierta}
              alt="Comprobante de pago"
              className="max-h-[85dvh] w-auto rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
