"use client";

/**
 * WALY MOTORS OS — Nuevo Contrato
 * ───────────────────────────────
 * Wizard de 4 pasos, mobile-first:
 *   1. Cliente     (búsqueda por nombre/documento)
 *   2. Vehículo    (solo mototaxis disponibles, con foto)
 *   3. Condiciones (alquiler o venta a crédito, cuotas, frecuencia)
 *   4. Confirmar   (resumen legal-friendly)
 *
 * Llama a la RPC atómica `crear_contrato`: bloquea el vehículo,
 * valida disponibilidad, registra la cuota inicial como primer
 * pago y cambia el estado de la mototaxi — todo en una transacción.
 */

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Check,
  ChevronLeft,
  Bike,
  FileSignature,
  KeyRound,
  CalendarDays,
} from "lucide-react";
import { soles, type FrecuenciaPago } from "@/lib/supabase";
import {
  useBuscarClientes,
  useVehiculosDisponibles,
  useCrearContrato,
  type ClienteBasico,
  type VehiculoDisponible,
} from "@/features/contratos/hooks/use-contratos";
import { cn } from "@/lib/utils";

// ── Constantes ───────────────────────────────────────────────
const FRECUENCIAS: { id: FrecuenciaPago; label: string }[] = [
  { id: "diario", label: "Diario" },
  { id: "semanal", label: "Semanal" },
  { id: "quincenal", label: "Quincenal" },
  { id: "mensual", label: "Mensual" },
];

const slide = {
  initial: { opacity: 0, x: 32 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -32 },
  transition: { type: "spring", stiffness: 320, damping: 32 },
} as const;

function Progreso({ paso, total }: { paso: number; total: number }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Paso ${paso} de ${total}`}>
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          className={cn(
            "h-1.5 rounded-full transition-all",
            n === paso ? "w-8 bg-amarillo" : "w-4",
            n < paso ? "bg-amarillo/60" : n > paso ? "bg-neutral-200 dark:bg-neutral-800" : "",
          )}
        />
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═════════════════════════════════════════════════════════════
export default function NuevoContrato() {
  const router = useRouter();
  const [paso, setPaso] = useState(1);

  // Estado del contrato
  const [terminoCliente, setTerminoCliente] = useState("");
  const [cliente, setCliente] = useState<ClienteBasico | null>(null);
  const [vehiculo, setVehiculo] = useState<VehiculoDisponible | null>(null);
  const [tipo, setTipo] = useState<"alquiler" | "venta_credito">("alquiler");
  const [montoTotal, setMontoTotal] = useState("");
  const [cuotaInicial, setCuotaInicial] = useState("0");
  const [montoCuota, setMontoCuota] = useState("");
  const [frecuencia, setFrecuencia] = useState<FrecuenciaPago>("diario");
  const [fechaInicio, setFechaInicio] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const clientes = useBuscarClientes(terminoCliente);
  const vehiculos = useVehiculosDisponibles();
  const crear = useCrearContrato();

  const nTotal = Number.parseFloat(montoTotal);
  const nInicial = Number.parseFloat(cuotaInicial) || 0;
  const nCuota = Number.parseFloat(montoCuota);
  const condicionesValidas =
    Number.isFinite(nTotal) && nTotal > 0 &&
    Number.isFinite(nCuota) && nCuota > 0 &&
    nInicial >= 0 && nInicial < nTotal;

  const numCuotasEstimadas = condicionesValidas
    ? Math.ceil((nTotal - nInicial) / nCuota)
    : 0;

  function seleccionarVehiculo(v: VehiculoDisponible) {
    setVehiculo(v);
    // Sugerencias según tipo de contrato y precios del vehículo
    if (tipo === "alquiler" && v.precio_alquiler_diario) {
      setMontoCuota(String(v.precio_alquiler_diario));
    }
    if (tipo === "venta_credito" && v.precio_venta) {
      setMontoTotal(String(v.precio_venta));
    }
    setPaso(3);
  }

  function confirmar() {
    if (!cliente || !vehiculo || !condicionesValidas) return;
    crear.mutate({
      clienteId: cliente.id,
      vehiculoId: vehiculo.id,
      tipo,
      montoTotal: nTotal,
      cuotaInicial: nInicial,
      montoCuota: nCuota,
      frecuencia,
      fechaInicio,
    });
  }

  // ── Pantalla de éxito ──────────────────────────────────────
  if (crear.isSuccess) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <span className="grid h-20 w-20 place-items-center rounded-3xl bg-emerald-500/15 text-emerald-500">
          <FileSignature className="h-10 w-10" />
        </span>
        <h1 className="text-xl font-black uppercase tracking-tight">Contrato creado</h1>
        <p className="text-sm text-neutral-500">
          {cliente?.nombre_completo} · placa{" "}
          <span className="font-mono font-bold">{vehiculo?.placa}</span>
          {nInicial > 0 && ` · cuota inicial de ${soles.format(nInicial)} registrada`}.
        </p>
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="mt-2 w-full rounded-xl bg-amarillo py-3.5 font-bold text-asfalto active:scale-[0.98]"
        >
          Ir al Dashboard
        </button>
      </motion.div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {paso > 1 && (
            <button
              type="button"
              onClick={() => setPaso((p) => p - 1)}
              aria-label="Volver al paso anterior"
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-lg font-black uppercase tracking-tight">Nuevo contrato</h1>
        </div>
        <Progreso paso={paso} total={4} />
      </header>

      <AnimatePresence mode="wait">
        {/* ══════════ PASO 1: CLIENTE ══════════ */}
        {paso === 1 && (
          <motion.section key="c1" {...slide} aria-label="Seleccionar cliente">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
              <input
                autoFocus
                type="search"
                value={terminoCliente}
                onChange={(e) => setTerminoCliente(e.target.value)}
                placeholder="Nombre o número de documento…"
                aria-label="Buscar cliente"
                className={cn(
                  "w-full rounded-2xl border border-neutral-200 bg-white py-3.5 pl-11 pr-4 text-base",
                  "dark:border-neutral-800 dark:bg-asfalto",
                  "focus-visible:outline-2 focus-visible:outline-amarillo",
                )}
              />
            </div>

            <ul className="mt-3 space-y-2" aria-live="polite">
              {clientes.data?.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCliente(c);
                      setPaso(2);
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3 text-left active:scale-[0.99] dark:border-neutral-800 dark:bg-asfalto"
                  >
                    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-800">
                      {c.foto_perfil ? (
                        <Image src={c.foto_perfil} alt="" fill className="object-cover" sizes="44px" />
                      ) : (
                        <span className="grid h-full w-full place-items-center font-black text-neutral-400">
                          {c.nombre_completo.charAt(0)}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{c.nombre_completo}</span>
                      <span className="block text-xs text-neutral-500">
                        Doc. <span className="font-mono">{c.numero_documento}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}

              {clientes.isSuccess && clientes.data.length === 0 && (
                <li className="rounded-2xl border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500 dark:border-neutral-700">
                  No existe «{terminoCliente}». Regístralo primero en{" "}
                  <button
                    type="button"
                    onClick={() => router.push("/clientes")}
                    className="font-bold text-amarillo underline"
                  >
                    Clientes
                  </button>
                  .
                </li>
              )}
            </ul>
          </motion.section>
        )}

        {/* ══════════ PASO 2: VEHÍCULO ══════════ */}
        {paso === 2 && (
          <motion.section key="c2" {...slide} aria-label="Seleccionar vehículo" className="space-y-3">
            {vehiculos.isLoading &&
              [0, 1].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-neutral-200/60 dark:bg-neutral-800/60" />
              ))}

            {vehiculos.data?.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => seleccionarVehiculo(v)}
                className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3 text-left active:scale-[0.99] dark:border-neutral-800 dark:bg-asfalto"
              >
                <span className="relative h-16 w-20 shrink-0 overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-800">
                  {v.fotos[0] ? (
                    <Image src={v.fotos[0]} alt={v.modelo} fill className="object-cover" sizes="80px" />
                  ) : (
                    <Bike className="m-auto h-full w-8 text-neutral-400" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-base font-black">{v.placa}</span>
                  <span className="block truncate text-sm text-neutral-500">
                    {v.modelo} {v.anio} · {v.kilometraje.toLocaleString("es-PE")} km
                  </span>
                  <span className="block text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                    {v.precio_alquiler_diario && `Alq. ${soles.format(v.precio_alquiler_diario)}/día`}
                    {v.precio_alquiler_diario && v.precio_venta && " · "}
                    {v.precio_venta && `Venta ${soles.format(v.precio_venta)}`}
                  </span>
                </span>
              </button>
            ))}

            {vehiculos.isSuccess && vehiculos.data.length === 0 && (
              <p className="rounded-2xl border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500 dark:border-neutral-700">
                No hay mototaxis disponibles. Todas están alquiladas, vendidas o en mantenimiento.
              </p>
            )}
          </motion.section>
        )}

        {/* ══════════ PASO 3: CONDICIONES ══════════ */}
        {paso === 3 && vehiculo && (
          <motion.section key="c3" {...slide} aria-label="Condiciones del contrato" className="space-y-5">
            {/* Tipo */}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "alquiler", label: "Alquiler", icono: <KeyRound className="h-5 w-5" /> },
                  { id: "venta_credito", label: "Venta a crédito", icono: <FileSignature className="h-5 w-5" /> },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tipo === t.id}
                  onClick={() => {
                    setTipo(t.id);
                    if (t.id === "alquiler" && vehiculo.precio_alquiler_diario)
                      setMontoCuota(String(vehiculo.precio_alquiler_diario));
                    if (t.id === "venta_credito" && vehiculo.precio_venta)
                      setMontoTotal(String(vehiculo.precio_venta));
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-2xl border py-3.5 text-sm font-semibold transition-colors",
                    tipo === t.id
                      ? "border-amarillo bg-amarillo/15 text-neutral-900 dark:text-amarillo"
                      : "border-neutral-200 text-neutral-500 dark:border-neutral-800",
                  )}
                >
                  {t.icono}
                  {t.label}
                </button>
              ))}
            </div>

            {/* Montos */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label htmlFor="total" className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                  Monto total del contrato (S/.)
                </label>
                <input
                  id="total"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={montoTotal}
                  onChange={(e) => setMontoTotal(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-xl font-black tabular-nums dark:border-neutral-800 dark:bg-asfalto focus-visible:outline-2 focus-visible:outline-amarillo"
                />
              </div>
              <div>
                <label htmlFor="inicial" className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                  Cuota inicial
                </label>
                <input
                  id="inicial"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={cuotaInicial}
                  onChange={(e) => setCuotaInicial(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 font-bold tabular-nums dark:border-neutral-800 dark:bg-asfalto focus-visible:outline-2 focus-visible:outline-amarillo"
                />
              </div>
              <div>
                <label htmlFor="cuota" className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                  Monto por cuota
                </label>
                <input
                  id="cuota"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={montoCuota}
                  onChange={(e) => setMontoCuota(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 font-bold tabular-nums dark:border-neutral-800 dark:bg-asfalto focus-visible:outline-2 focus-visible:outline-amarillo"
                />
              </div>
            </div>

            {/* Frecuencia */}
            <fieldset>
              <legend className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                Frecuencia de pago
              </legend>
              <div className="mt-1 grid grid-cols-4 gap-2">
                {FRECUENCIAS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={frecuencia === f.id}
                    onClick={() => setFrecuencia(f.id)}
                    className={cn(
                      "rounded-xl border py-2.5 text-xs font-semibold transition-colors",
                      frecuencia === f.id
                        ? "border-amarillo bg-amarillo/15 text-neutral-900 dark:text-amarillo"
                        : "border-neutral-200 text-neutral-500 dark:border-neutral-800",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Fecha de inicio */}
            <div>
              <label htmlFor="inicio" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                <CalendarDays className="h-3.5 w-3.5" /> Fecha de inicio
              </label>
              <input
                id="inicio"
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-asfalto focus-visible:outline-2 focus-visible:outline-amarillo"
              />
            </div>

            {condicionesValidas && (
              <p className="rounded-xl bg-amarillo/10 p-3 text-sm">
                ≈ <span className="font-black">{numCuotasEstimadas}</span> cuotas de{" "}
                <span className="font-black">{soles.format(nCuota)}</span> ({frecuencia})
                {nInicial > 0 && (
                  <> tras una inicial de <span className="font-black">{soles.format(nInicial)}</span></>
                )}
                .
              </p>
            )}

            <button
              type="button"
              disabled={!condicionesValidas}
              onClick={() => setPaso(4)}
              className="w-full rounded-xl bg-amarillo py-4 font-bold text-asfalto active:scale-[0.98] disabled:opacity-40"
            >
              Revisar contrato
            </button>
          </motion.section>
        )}

        {/* ══════════ PASO 4: CONFIRMAR ══════════ */}
        {paso === 4 && cliente && vehiculo && (
          <motion.section key="c4" {...slide} aria-label="Confirmar contrato" className="space-y-5">
            <dl className="space-y-2 rounded-2xl border border-neutral-200 p-4 text-sm dark:border-neutral-800">
              {[
                ["Cliente", cliente.nombre_completo],
                ["Documento", cliente.numero_documento],
                ["Vehículo", `${vehiculo.placa} · ${vehiculo.modelo} ${vehiculo.anio}`],
                ["Tipo", tipo === "alquiler" ? "Alquiler" : "Venta a crédito"],
                ["Monto total", soles.format(nTotal)],
                ["Cuota inicial", soles.format(nInicial)],
                ["Cuota", `${soles.format(nCuota)} · ${frecuencia}`],
                ["Cuotas estimadas", String(numCuotasEstimadas)],
                ["Inicio", new Date(`${fechaInicio}T12:00:00`).toLocaleDateString("es-PE")],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-neutral-500">{k}</dt>
                  <dd className="text-right font-bold">{v}</dd>
                </div>
              ))}
            </dl>

            <p className="text-xs text-neutral-500">
              Al confirmar, la mototaxi pasará a estado{" "}
              <span className="font-bold">{tipo === "alquiler" ? "alquilado" : "vendido"}</span>
              {nInicial > 0 && " y la cuota inicial quedará registrada como primer pago"}.
            </p>

            {crear.isError && (
              <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">
                {crear.error instanceof Error
                  ? crear.error.message
                  : "No se pudo crear el contrato. Intenta de nuevo."}
              </p>
            )}

            <button
              type="button"
              onClick={confirmar}
              disabled={crear.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amarillo py-4 font-bold text-asfalto active:scale-[0.98] disabled:opacity-60"
            >
              {crear.isPending ? (
                "Creando contrato…"
              ) : (
                <>
                  <Check className="h-5 w-5" strokeWidth={3} /> Confirmar y activar
                </>
              )}
            </button>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
