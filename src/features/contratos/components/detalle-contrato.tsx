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
  FileSignature,
  Flag,
  ImageIcon,
  Share2,
  Download,
  MessageCircle,
  MoreVertical,
  X,
} from "lucide-react";
import { supabase, soles, type MetodoPago, type FrecuenciaPago } from "@/lib/supabase";
import { useFinalizarContrato } from "@/features/contratos/hooks/use-contratos";
import { generarComprobantePago, compartirComprobante, type ResultadoComprobante } from "@/lib/comprobante";
import { generarContratoPdf } from "@/lib/contrato-pdf";
import { cn, urlFirmada, abrirWhatsApp } from "@/lib/utils";

// ── Tipos ────────────────────────────────────────────────────
interface ResumenContrato {
  contrato_id: string;
  tipo: "alquiler" | "venta_credito";
  estado: "activo" | "vencido" | "finalizado";
  monto_total: number;
  cuota_inicial: number;
  monto_cuota: number;
  frecuencia_pago: FrecuenciaPago;
  fecha_inicio: string;
  fecha_fin: string | null;
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
  perfiles: { nombre: string } | null;
}

const ICONO_METODO: Record<MetodoPago, React.ReactNode> = {
  yape: <Smartphone className="h-4 w-4" />,
  plin: <Smartphone className="h-4 w-4" />,
  efectivo: <Banknote className="h-4 w-4" />,
  transferencia: <Landmark className="h-4 w-4" />,
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
        .select("id, monto_recibido, fecha_pago, metodo_pago, estado, evidencia_url, observaciones, perfiles:recaudador_id (nombre)")
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

  const [confirmarFin, setConfirmarFin] = useState(false);
  const [evidenciaAbierta, setEvidenciaAbierta] = useState<string | null>(null);
  const [errorFinalizar, setErrorFinalizar] = useState<string | null>(null);
  const [generandoContrato, setGenerandoContrato] = useState(false);
  const [estadoComprobante, setEstadoComprobante] = useState<{ id: string; resultado: ResultadoComprobante } | null>(null);
  const [menuPago, setMenuPago] = useState<PagoContrato | null>(null);
  const [avisoContrato, setAvisoContrato] = useState<string | null>(null);

  const r = resumen.data;

  async function verEvidencia(ruta: string) {
    const url = await urlFirmada("evidencias", ruta);
    if (url) setEvidenciaAbierta(url);
  }

  /** Devuelve la ruta interna del PDF del contrato, generándolo y
   *  subiéndolo la primera vez si todavía no existe (contratos creados
   *  antes de esta función, o si la subida original falló). */
  async function asegurarRutaContratoPdf(): Promise<string | null> {
    if (!r) return null;
    if (r.contrato_pdf_url) return r.contrato_pdf_url;

    try {
      const numCuotas = r.monto_cuota > 0 ? Math.ceil((r.monto_total - r.cuota_inicial) / r.monto_cuota) : 0;
      const pdf = generarContratoPdf({
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
        documentosGarantia: r.documentos_garantia,
      });

      const ruta = `${r.contrato_id}/contrato.pdf`;
      const archivo = new File([pdf.output("blob")], "contrato.pdf", { type: "application/pdf" });
      const { error } = await supabase.storage
        .from("contratos")
        .upload(ruta, archivo, { contentType: "application/pdf", upsert: true });
      if (error) return null;

      await supabase.from("contratos").update({ contrato_pdf_url: ruta }).eq("id", r.contrato_id);
      void resumen.refetch();
      return ruta;
    } catch {
      // Datos incompletos u otro error de generación: no rompe la pantalla,
      // solo impide obtener una ruta (el botón mostrará el aviso genérico).
      return null;
    }
  }

  async function descargarContrato() {
    setGenerandoContrato(true);
    setAvisoContrato(null);
    try {
      const ruta = await asegurarRutaContratoPdf();
      if (!ruta) {
        setAvisoContrato("No se pudo generar el contrato. Intenta de nuevo.");
        return;
      }
      const url = await urlFirmada("contratos", ruta, SEGUNDOS_ENLACE_CONTRATO);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
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
      if (!ruta) {
        setAvisoContrato("No se pudo generar el contrato. Intenta de nuevo.");
        return;
      }
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
        `Hola ${primerNombre}, te compartimos el contrato de tu mototaxi placa ${r.vehiculo_placa} con Waly Motors. ` +
        `Puedes revisarlo aquí (enlace válido por 7 días): ${url}`;
      abrirWhatsApp(r.cliente_telefono, mensaje);
    } finally {
      setGenerandoContrato(false);
    }
  }

  async function enviarComprobantePago(p: PagoContrato) {
    if (!r) return;
    setEstadoComprobante(null);
    const doc = generarComprobantePago({
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
    const mensaje = `Hola ${primerNombre}, aquí tu comprobante de pago de ${soles.format(p.monto_recibido)} — Waly Motors. ¡Gracias por tu preferencia!`;
    const resultado = await compartirComprobante(
      doc,
      `comprobante-${r.vehiculo_placa}-${p.id.slice(0, 6)}.pdf`,
      r.cliente_telefono,
      mensaje,
    );
    setEstadoComprobante({ id: p.id, resultado });
    setMenuPago(null);
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-black uppercase tracking-tight text-grafito">
          <FileSignature className="h-5 w-5 text-cobre" /> Contrato
        </h1>
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
            {r.estado === "activo" ? "Activo" : r.estado === "vencido" ? "Vencido" : "Finalizado"}
          </span>
        )}
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
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-cobre bg-cobre/10 py-3 text-sm font-bold text-cobre active:scale-[0.98] disabled:opacity-50"
            >
              <MessageCircle className="h-4 w-4" /> {generandoContrato ? "Generando…" : "Enviar por WhatsApp"}
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
                  {fechaHora.format(new Date(p.fecha_pago))} · {p.metodo_pago}
                  {p.perfiles?.nombre && ` · ${p.perfiles.nombre}`}
                  {p.estado === "parcial" && " · parcial"}
                </p>
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
          ) : (
            <div className="space-y-3 rounded-2xl border border-oxido/30 bg-oxido/5 p-4">
              <p className="text-sm text-grafito">
                {r.tipo === "alquiler"
                  ? "Se cerrará el contrato y la mototaxi volverá a estado disponible."
                  : "Se cerrará el contrato de venta a crédito. La mototaxi permanecerá como vendida."}
                {r.saldo > 0 && (
                  <>
                    {" "}Queda un saldo pendiente de{" "}
                    <span className="font-black">{soles.format(r.saldo)}</span>.
                  </>
                )}
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
                  onClick={() => {
                    setErrorFinalizar(null);
                    finalizar.mutate(contratoId, {
                      onSuccess: () => {
                        setConfirmarFin(false);
                        void resumen.refetch();
                      },
                      onError: (err) => {
                        setErrorFinalizar(
                          err instanceof Error
                            ? err.message
                            : "No se pudo finalizar el contrato. Intenta de nuevo.",
                        );
                      },
                    });
                  }}
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
                <MessageCircle className="h-4 w-4 text-grafito/50" /> Enviar contrato por WhatsApp
              </button>
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
