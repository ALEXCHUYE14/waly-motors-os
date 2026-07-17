"use client";

/**
 * WALY MOTORS OS — Detalle de Contrato
 * Barra de progreso financiero (RPC resumen_contrato),
 * historial de pagos con evidencias firmadas y botón de
 * finalización (RPC finalizar_contrato, libera la mototaxi).
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
  X,
} from "lucide-react";
import { supabase, soles, type MetodoPago } from "@/lib/supabase";
import { useFinalizarContrato } from "@/features/contratos/hooks/use-contratos";
import { cn, urlFirmada } from "@/lib/utils";

// ── Tipos ────────────────────────────────────────────────────
interface ResumenContrato {
  contrato_id: string;
  tipo: "alquiler" | "venta_credito";
  estado: "activo" | "vencido" | "finalizado";
  monto_total: number;
  total_pagado: number;
  saldo: number;
  pct_avance: number;
  num_pagos: number;
  ultimo_pago: string | null;
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

  const r = resumen.data;

  async function verEvidencia(ruta: string) {
    const url = await urlFirmada("evidencias", ruta);
    if (url) setEvidenciaAbierta(url);
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-black uppercase tracking-tight">
          <FileSignature className="h-5 w-5 text-amarillo" /> Contrato
        </h1>
        {r && (
          <span
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-bold",
              r.estado === "activo"
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : r.estado === "vencido"
                  ? "bg-oxido/15 text-oxido"
                  : "bg-neutral-500/15 text-neutral-500",
            )}
          >
            {r.estado === "activo" ? "Activo" : r.estado === "vencido" ? "Vencido" : "Finalizado"}
          </span>
        )}
      </header>

      {/* ── Progreso financiero ── */}
      {resumen.isLoading ? (
        <div className="h-36 animate-pulse rounded-2xl bg-neutral-200/60 dark:bg-neutral-800/60" />
      ) : r ? (
        <section
          aria-label="Progreso financiero"
          className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-asfalto"
        >
          <div className="flex items-baseline justify-between">
            <p className="text-3xl font-black tabular-nums">{r.pct_avance}%</p>
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">
              {r.tipo === "alquiler" ? "Alquiler" : "Venta a crédito"} · {r.num_pagos} pagos
            </p>
          </div>

          <div
            role="progressbar"
            aria-valuenow={r.pct_avance}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-3 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
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
              <div key={k} className="rounded-xl bg-neutral-100 p-2 dark:bg-neutral-900">
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">{k}</dt>
                <dd className={cn("font-black tabular-nums", extra)}>{v}</dd>
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
        <h2 className="text-sm font-black uppercase tracking-widest text-neutral-400">
          Historial de pagos
        </h2>

        {pagos.isLoading &&
          [0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-neutral-200/60 dark:bg-neutral-800/60" />
          ))}

        {pagos.data?.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-asfalto"
          >
            <span
              className={cn(
                "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                p.estado === "completado"
                  ? "bg-emerald-500/15 text-emerald-500"
                  : p.estado === "parcial"
                    ? "bg-amarillo/20 text-asfalto dark:text-amarillo"
                    : "bg-oxido/15 text-oxido",
              )}
            >
              {ICONO_METODO[p.metodo_pago]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-black tabular-nums">{soles.format(p.monto_recibido)}</p>
              <p className="truncate text-xs text-neutral-500">
                {fechaHora.format(new Date(p.fecha_pago))} · {p.metodo_pago}
                {p.perfiles?.nombre && ` · ${p.perfiles.nombre}`}
                {p.estado === "parcial" && " · parcial"}
              </p>
            </div>
            {p.evidencia_url && (
              <button
                type="button"
                onClick={() => void verEvidencia(p.evidencia_url as string)}
                aria-label="Ver comprobante"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-100 text-neutral-500 dark:bg-neutral-900"
              >
                <ImageIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}

        {pagos.isSuccess && pagos.data.length === 0 && (
          <p className="rounded-2xl border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500 dark:border-neutral-700">
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
              <p className="text-sm">
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
                  className="flex-1 rounded-xl border border-neutral-200 py-3 text-sm font-semibold dark:border-neutral-700"
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
            className="w-full rounded-xl bg-amarillo py-3.5 font-bold text-asfalto active:scale-[0.98]"
          >
            Registrar un cobro
          </button>
        </section>
      )}

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
            className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4 backdrop-blur-sm"
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
