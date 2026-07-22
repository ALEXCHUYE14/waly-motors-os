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
 * (ver useRegistrarPago). Tras confirmar, se puede generar y
 * compartir por WhatsApp un comprobante en PDF (ver lib/comprobante).
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
  Share2,
} from "lucide-react";
import { supabase, soles, type MetodoPago } from "@/lib/supabase";
import { useRegistrarPago } from "@/features/pagos/hooks/use-registrar-pago";
import { generarComprobantePago, compartirComprobante, type ResultadoComprobante } from "@/lib/comprobante";
import { cn, urlFirmadas, mensajeError } from "@/lib/utils";

// ── Tipos ────────────────────────────────────────────────────
interface ResultadoBusqueda {
  contrato_id: string;
  cliente_id: string;
  nombre_completo: string;
  numero_documento: string;
  foto_perfil: string | null;
  telefono: string | null;
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

const MENSAJE_COMPROBANTE: Record<ResultadoComprobante, string> = {
  compartido: "Comprobante enviado.",
  descargado: "Comprobante descargado — ábrelo en WhatsApp para adjuntarlo.",
  cancelado: "Envío cancelado.",
};

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

      const resultados = (data ?? []) as ResultadoBusqueda[];

      // Bucket `clientes` es privado — firmar antes de exponer al UI.
      const rutas = resultados.map((r) => r.foto_perfil).filter(Boolean) as string[];
      const urlPorRuta = await urlFirmadas("clientes", rutas);

      return resultados.map((r) => ({
        ...r,
        foto_perfil: r.foto_perfil ? urlPorRuta.get(r.foto_perfil) ?? null : null,
      }));
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
            n < paso ? "bg-amarillo/60" : n > paso ? "bg-borde" : "",
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

  // Comprobante PDF
  const [enviandoComprobante, setEnviandoComprobante] = useState(false);
  const [estadoComprobante, setEstadoComprobante] = useState<ResultadoComprobante | null>(null);

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

  async function enviarComprobante() {
    if (!seleccion) return;
    setEnviandoComprobante(true);
    setEstadoComprobante(null);
    try {
      const doc = await generarComprobantePago({
        folio: `RE-${Date.now().toString(36).toUpperCase()}`,
        fechaIso: new Date().toISOString(),
        clienteNombre: seleccion.nombre_completo,
        clienteDocumento: seleccion.numero_documento,
        vehiculoPlaca: seleccion.placa,
        vehiculoModelo: seleccion.modelo,
        monto: montoNum,
        metodo,
      });
      const primerNombre = seleccion.nombre_completo.split(" ")[0];
      const mensaje = `Hola ${primerNombre}, aquí tu comprobante de pago de ${soles.format(montoNum)} — Waly Motors. ¡Gracias por tu preferencia!`;
      const resultado = await compartirComprobante(
        doc,
        `comprobante-${seleccion.placa}.pdf`,
        seleccion.telefono,
        mensaje,
      );
      setEstadoComprobante(resultado);
    } finally {
      setEnviandoComprobante(false);
    }
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
    setEstadoComprobante(null);
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
            offline ? "bg-amarillo/20 text-grafito" : "bg-emerald-500/15 text-emerald-500",
          )}
        >
          {offline ? <CloudOff className="h-10 w-10" /> : <Check className="h-10 w-10" strokeWidth={3} />}
        </span>

        <h1 className="text-xl font-black uppercase tracking-tight text-grafito">
          {offline ? "Cobro guardado sin señal" : "Pago registrado"}
        </h1>
        <p className="text-sm text-grafito/50">
          {offline
            ? `Se enviará automáticamente cuando vuelva la conexión. Pendientes en cola: ${registrar.pendientesEnCola}.`
            : `${soles.format(montoNum)} de ${seleccion?.nombre_completo} vía ${metodo}.`}
        </p>

        {seleccion && (
          <div className="w-full space-y-2">
            <button
              type="button"
              onClick={() => void enviarComprobante()}
              disabled={enviandoComprobante}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-cobre bg-cobre/10 py-3 text-sm font-bold text-cobre active:scale-[0.98] disabled:opacity-50"
            >
              <Share2 className="h-4 w-4" />
              {enviandoComprobante ? "Generando comprobante…" : "Enviar comprobante"}
            </button>
            {estadoComprobante && (
              <p className="text-xs text-grafito/50">{MENSAJE_COMPROBANTE[estadoComprobante]}</p>
            )}
          </div>
        )}

        <div className="mt-2 flex w-full gap-2">
          <button
            type="button"
            onClick={reiniciar}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amarillo py-3.5 font-bold text-grafito active:scale-[0.98]"
          >
            <RotateCcw className="h-4 w-4" /> Nuevo cobro
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="flex-1 rounded-xl border border-borde py-3.5 text-sm font-semibold text-grafito"
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
              className="rounded-lg p-1.5 text-grafito/40 hover:bg-fondo"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-lg font-black uppercase tracking-tight text-grafito">
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
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-grafito/30" />
              <input
                autoFocus
                type="search"
                inputMode="search"
                value={termino}
                onChange={(e) => setTermino(e.target.value)}
                placeholder="Nombre, DNI o placa…"
                aria-label="Buscar cliente o placa"
                className="w-full rounded-2xl border border-borde bg-tarjeta py-3.5 pl-11 pr-4 text-base text-grafito focus-visible:outline-2 focus-visible:outline-amarillo"
              />
            </div>

            <ul className="mt-3 space-y-2" aria-live="polite">
              {busqueda.isFetching && (
                <li className="h-[68px] animate-pulse rounded-2xl bg-borde/60" />
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
                    className="flex w-full items-center gap-3 rounded-2xl border border-borde bg-tarjeta p-3 text-left shadow-card active:scale-[0.99]"
                  >
                    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-fondo">
                      {r.foto_perfil ? (
                        <Image src={r.foto_perfil} alt="" fill className="object-cover" sizes="44px" />
                      ) : (
                        <span className="grid h-full w-full place-items-center font-black text-grafito/30">
                          {r.nombre_completo.charAt(0)}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-grafito">{r.nombre_completo}</span>
                      <span className="block text-xs text-grafito/50">
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
                <li className="rounded-2xl border border-dashed border-borde p-4 text-center text-sm text-grafito/50">
                  Sin resultados para «{termino}». Verifica la placa o el documento.
                </li>
              )}
            </ul>
          </motion.section>
        )}

        {/* ══════════ PASO 2: MONTO Y MÉTODO ══════════ */}
        {paso === 2 && seleccion && (
          <motion.section key="p2" {...slide} aria-label="Monto y método de pago" className="space-y-5">
            <div className="rounded-2xl bg-cobre/10 p-3 text-sm">
              <span className="font-semibold text-grafito">{seleccion.nombre_completo}</span>
              <span className="text-grafito/50"> · placa </span>
              <span className="font-mono font-bold text-grafito">{seleccion.placa}</span>
            </div>

            <div>
              <label htmlFor="monto" className="text-[11px] font-semibold uppercase tracking-widest text-grafito/40">
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
                className="mt-1 w-full rounded-2xl border border-borde bg-tarjeta px-4 py-4 text-3xl font-black tabular-nums text-grafito focus-visible:outline-2 focus-visible:outline-amarillo"
              />
              <div className="mt-2 flex gap-2">
                {[seleccion.monto_cuota, seleccion.monto_cuota * 2, seleccion.monto_cuota / 2].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMonto(m.toFixed(2))}
                    className="rounded-lg border border-borde px-3 py-1.5 text-xs font-bold text-grafito"
                  >
                    {soles.format(m)}
                  </button>
                ))}
              </div>
            </div>

            <fieldset>
              <legend className="text-[11px] font-semibold uppercase tracking-widest text-grafito/40">
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
                        ? "border-amarillo bg-amarillo/15 text-grafito"
                        : "border-borde text-grafito/50",
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
              className="w-full rounded-xl bg-amarillo py-4 font-bold text-grafito active:scale-[0.98] disabled:opacity-40"
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
                previewUrl ? "aspect-[4/3] border-transparent" : "h-40 border-borde text-grafito/40",
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
                className="w-full rounded-xl border border-borde py-2.5 text-sm font-semibold text-grafito"
              >
                Volver a tomar
              </button>
            )}

            {/* Resumen */}
            <dl className="space-y-2 rounded-2xl border border-borde bg-tarjeta p-4 text-sm shadow-card">
              {[
                ["Cliente", seleccion.nombre_completo],
                ["Placa", seleccion.placa],
                ["Monto", soles.format(montoNum)],
                ["Método", METODOS.find((m) => m.id === metodo)?.label ?? metodo],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-grafito/50">{k}</dt>
                  <dd className="font-bold text-grafito">{v}</dd>
                </div>
              ))}
            </dl>

            {registrar.isError && !registrar.encoladoOffline && (
              <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">
                {mensajeError(registrar.error, "No se pudo registrar el pago. Intenta de nuevo.")}
              </p>
            )}

            <button
              type="button"
              onClick={confirmarCobro}
              disabled={registrar.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amarillo py-4 font-bold text-grafito active:scale-[0.98] disabled:opacity-60"
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
