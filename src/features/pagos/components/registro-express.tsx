"use client";

/**
 * WALY MOTORS OS — Registro Express (PWA)
 * ───────────────────────────────────────
 * Cobro rápido en calle, 3 pasos, una mano:
 *   1. Buscar cliente / placa  (RPC buscar_contratos_activos, trgm)
 *   2. Monto + método de pago  (Yape · Plin · Efectivo · Transferencia)
 *   3. Foto del comprobante    (cámara nativa) + confirmar
 *
 * Si no hay señal, el cobro se encola y sincroniza solo
 * (ver useRegistrarPago).
 */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Camera,
  Check,
  ChevronLeft,
  CloudOff,
  Banknote,
  Smartphone,
  Landmark,
  RotateCcw,
} from "lucide-react";
import { supabase, soles, type MetodoPago } from "@/lib/supabase";
import { useRegistrarPago } from "@/features/pagos/hooks/use-registrar-pago";
import { cn } from "@/lib/utils";

// ── Tipos ────────────────────────────────────────────────────
interface ResultadoBusqueda {
  contrato_id: string;
  cliente_id: string;
  nombre_completo: string;
  numero_documento: string;
  foto_perfil: string | null;
  placa: string;
  modelo: string;
  monto_cuota: number;
  frecuencia_pago: string;
  dias_retraso: number;
}

const METODOS: { id: MetodoPago; label: string; icono: React.ReactNode }[] = [
  { id: "yape", label: "Yape", icono: <Smartphone className="h-5 w-5" /> },
  { id: "plin", label: "Plin", icono: <Smartphone className="h-5 w-5" /> },
  { id: "efectivo", label: "Efectivo", icono: <Banknote className="h-5 w-5" /> },
  { id: "transferencia", label: "Transf.", icono: <Landmark className="h-5 w-5" /> },
];

// ── Hook: búsqueda con debounce ──────────────────────────────
function useBusquedaContratos(termino: string) {
  const [debounced, setDebounced] = useState(termino);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(termino), 300);
    return () => clearTimeout(t);
  }, [termino]);

  return useQuery({
    queryKey: ["buscar-contratos", debounced],
    enabled: debounced.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<ResultadoBusqueda[]> => {
      const { data, error } = await supabase.rpc("buscar_contratos_activos", {
        p_termino: debounced.trim(),
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ── Indicador de progreso ────────────────────────────────────
function Progreso({ paso }: { paso: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Paso ${paso} de 3`}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn(
            "h-1.5 rounded-full transition-all",
            n === paso ? "w-8 bg-amarillo" : "w-4",
            n < paso
              ? "bg-amarillo/60"
              : n > paso
                ? "bg-neutral-200 dark:bg-neutral-800"
                : "",
          )}
        />
      ))}
    </div>
  );
}

const slide = {
  initial: { opacity: 0, x: 32 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -32 },
  transition: { type: "spring", stiffness: 320, damping: 32 },
} as const;

// ═════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═════════════════════════════════════════════════════════════
export default function RegistroExpress() {
  const router = useRouter();
  const [paso, setPaso] = useState<1 | 2 | 3>(1);

  // Estado del cobro
  const [termino, setTermino] = useState("");
  const [seleccion, setSeleccion] = useState<ResultadoBusqueda | null>(null);
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState<MetodoPago>("yape");
  const [evidencia, setEvidencia] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const inputCamara = useRef<HTMLInputElement>(null);
  const busqueda = useBusquedaContratos(termino);
  const registrar = useRegistrarPago();

  const montoNum = Number.parseFloat(monto);
  const montoValido = Number.isFinite(montoNum) && montoNum > 0;

  // Limpieza del object URL del preview
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function onFotoCapturada(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setEvidencia(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  function confirmarCobro() {
    if (!seleccion || !montoValido) return;
    registrar.mutate({
      contratoId: seleccion.contrato_id,
      monto: montoNum,
      metodo,
      evidencia,
    });
  }

  function reiniciar() {
    registrar.reset();
    setPaso(1);
    setTermino("");
    setSeleccion(null);
    setMonto("");
    setMetodo("yape");
    setEvidencia(null);
    setPreviewUrl(null);
  }

  // ── Pantalla de éxito / encolado offline ───────────────────
  if (registrar.isSuccess || registrar.encoladoOffline) {
    const offline = registrar.encoladoOffline;
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <span
          className={cn(
            "grid h-20 w-20 place-items-center rounded-3xl",
            offline
              ? "bg-amarillo/15 text-asfalto dark:text-amarillo"
              : "bg-emerald-500/15 text-emerald-500",
          )}
        >
          {offline ? <CloudOff className="h-10 w-10" /> : <Check className="h-10 w-10" strokeWidth={3} />}
        </span>

        <h1 className="text-xl font-black uppercase tracking-tight">
          {offline ? "Cobro guardado sin señal" : "Pago registrado"}
        </h1>
        <p className="text-sm text-neutral-500">
          {offline
            ? `Se enviará automáticamente cuando vuelva la conexión. Pendientes en cola: ${registrar.pendientesEnCola}.`
            : `${soles.format(montoNum)} de ${seleccion?.nombre_completo} vía ${metodo}.`}
        </p>

        <div className="mt-2 flex w-full gap-2">
          <button
            type="button"
            onClick={reiniciar}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amarillo py-3.5 font-bold text-asfalto active:scale-[0.98]"
          >
            <RotateCcw className="h-4 w-4" /> Nuevo cobro
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="flex-1 rounded-xl border border-neutral-200 py-3.5 text-sm font-semibold dark:border-neutral-700"
          >
            Ir al Dashboard
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5 p-4 sm:p-6">
      {/* Encabezado */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {paso > 1 && (
            <button
              type="button"
              onClick={() => setPaso((p) => (p - 1) as 1 | 2)}
              aria-label="Volver al paso anterior"
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-lg font-black uppercase tracking-tight">
            Registro Express
          </h1>
        </div>
        <Progreso paso={paso} />
      </header>

      <AnimatePresence mode="wait">
        {/* ══════════ PASO 1: BÚSQUEDA ══════════ */}
        {paso === 1 && (
          <motion.section key="p1" {...slide} aria-label="Buscar cliente o placa">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
              <input
                autoFocus
                type="search"
                inputMode="search"
                value={termino}
                onChange={(e) => setTermino(e.target.value)}
                placeholder="Nombre, DNI o placa…"
                aria-label="Buscar cliente o placa"
                className={cn(
                  "w-full rounded-2xl border border-neutral-200 bg-white py-3.5 pl-11 pr-4 text-base",
                  "dark:border-neutral-800 dark:bg-asfalto",
                  "focus-visible:outline-2 focus-visible:outline-amarillo",
                )}
              />
            </div>

            <ul className="mt-3 space-y-2" aria-live="polite">
              {busqueda.isFetching && (
                <li className="h-[68px] animate-pulse rounded-2xl bg-neutral-200/60 dark:bg-neutral-800/60" />
              )}

              {busqueda.data?.map((r) => (
                <li key={r.contrato_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSeleccion(r);
                      setMonto(String(r.monto_cuota));
                      setPaso(2);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl border p-3 text-left active:scale-[0.99]",
                      "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-asfalto",
                    )}
                  >
                    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-800">
                      {r.foto_perfil ? (
                        <Image src={r.foto_perfil} alt="" fill className="object-cover" sizes="44px" />
                      ) : (
                        <span className="grid h-full w-full place-items-center font-black text-neutral-400">
                          {r.nombre_completo.charAt(0)}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.nombre_completo}</span>
                      <span className="block text-xs text-neutral-500">
                        <span className="font-mono font-bold">{r.placa}</span> · {r.modelo} ·{" "}
                        {soles.format(r.monto_cuota)} {r.frecuencia_pago}
                      </span>
                    </span>
                    {r.dias_retraso > 0 && (
                      <span className="shrink-0 rounded-lg bg-oxido/10 px-2 py-1 text-xs font-bold text-oxido">
                        −{r.dias_retraso}d
                      </span>
                    )}
                  </button>
                </li>
              ))}

              {busqueda.isSuccess && busqueda.data.length === 0 && (
                <li className="rounded-2xl border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500 dark:border-neutral-700">
                  Sin resultados para «{termino}». Verifica la placa o el documento.
                </li>
              )}
            </ul>
          </motion.section>
        )}

        {/* ══════════ PASO 2: MONTO Y MÉTODO ══════════ */}
        {paso === 2 && seleccion && (
          <motion.section key="p2" {...slide} aria-label="Monto y método de pago" className="space-y-5">
            <div className="rounded-2xl bg-amarillo/10 p-3 text-sm">
              <span className="font-semibold">{seleccion.nombre_completo}</span>
              <span className="text-neutral-500"> · placa </span>
              <span className="font-mono font-bold">{seleccion.placa}</span>
            </div>

            <div>
              <label htmlFor="monto" className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                Monto recibido (S/.)
              </label>
              <input
                id="monto"
                type="number"
                inputMode="decimal"
                step="0.10"
                min="0"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className={cn(
                  "mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-3xl font-black tabular-nums",
                  "dark:border-neutral-800 dark:bg-asfalto",
                  "focus-visible:outline-2 focus-visible:outline-amarillo",
                )}
              />
              <div className="mt-2 flex gap-2">
                {[seleccion.monto_cuota, seleccion.monto_cuota * 2, seleccion.monto_cuota / 2].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMonto(m.toFixed(2))}
                    className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-bold dark:border-neutral-700"
                  >
                    {soles.format(m)}
                  </button>
                ))}
              </div>
            </div>

            <fieldset>
              <legend className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                Método de pago
              </legend>
              <div className="mt-1 grid grid-cols-4 gap-2">
                {METODOS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMetodo(m.id)}
                    aria-pressed={metodo === m.id}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-2xl border py-3 text-xs font-semibold transition-colors",
                      metodo === m.id
                        ? "border-amarillo bg-amarillo/15 text-neutral-900 dark:text-amarillo"
                        : "border-neutral-200 text-neutral-500 dark:border-neutral-800",
                    )}
                  >
                    {m.icono}
                    {m.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <button
              type="button"
              disabled={!montoValido}
              onClick={() => setPaso(3)}
              className="w-full rounded-xl bg-amarillo py-4 font-bold text-asfalto active:scale-[0.98] disabled:opacity-40"
            >
              Continuar
            </button>
          </motion.section>
        )}

        {/* ══════════ PASO 3: EVIDENCIA Y CONFIRMAR ══════════ */}
        {paso === 3 && seleccion && (
          <motion.section key="p3" {...slide} aria-label="Evidencia y confirmación" className="space-y-5">
            {/* Cámara nativa */}
            <input
              ref={inputCamara}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFotoCapturada}
              className="sr-only"
              aria-label="Capturar foto del comprobante"
            />
            <button
              type="button"
              onClick={() => inputCamara.current?.click()}
              className={cn(
                "relative grid w-full place-items-center overflow-hidden rounded-2xl border-2 border-dashed",
                previewUrl
                  ? "aspect-[4/3] border-transparent"
                  : "h-40 border-neutral-300 text-neutral-400 dark:border-neutral-700",
              )}
            >
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="Comprobante capturado" className="h-full w-full object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-2 text-sm font-semibold">
                  <Camera className="h-8 w-8" />
                  Tomar foto del comprobante
                  <span className="text-xs font-normal">
                    {metodo === "efectivo" ? "Opcional para efectivo" : "Captura de Yape/Plin/voucher"}
                  </span>
                </span>
              )}
            </button>
            {previewUrl && (
              <button
                type="button"
                onClick={() => inputCamara.current?.click()}
                className="w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold dark:border-neutral-700"
              >
                Volver a tomar
              </button>
            )}

            {/* Resumen */}
            <dl className="space-y-2 rounded-2xl border border-neutral-200 p-4 text-sm dark:border-neutral-800">
              {[
                ["Cliente", seleccion.nombre_completo],
                ["Placa", seleccion.placa],
                ["Monto", soles.format(montoNum)],
                ["Método", METODOS.find((m) => m.id === metodo)?.label ?? metodo],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-neutral-500">{k}</dt>
                  <dd className="font-bold">{v}</dd>
                </div>
              ))}
            </dl>

            {registrar.isError && !registrar.encoladoOffline && (
              <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">
                {registrar.error instanceof Error
                  ? registrar.error.message
                  : "No se pudo registrar el pago. Intenta de nuevo."}
              </p>
            )}

            <button
              type="button"
              onClick={confirmarCobro}
              disabled={registrar.isPending}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl py-4 font-bold",
                "bg-amarillo text-asfalto active:scale-[0.98] disabled:opacity-60",
              )}
            >
              {registrar.isPending ? (
                "Registrando…"
              ) : (
                <>
                  <Check className="h-5 w-5" strokeWidth={3} /> Confirmar cobro
                </>
              )}
            </button>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
