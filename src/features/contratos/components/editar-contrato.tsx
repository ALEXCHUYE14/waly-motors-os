"use client";

/**
 * WALY MOTORS OS — Editar Contrato
 * ─────────────────────────────────
 * Corrige un contrato con errores (monto, cuota, frecuencia, fechas,
 * duración/tarifas) SIN finalizarlo ni eliminarlo. Cliente, vehículo y
 * tipo de contrato NO son editables aquí — son estructurales: cambiarlos
 * exige rehacer el bloqueo de disponibilidad del vehículo que ya hace
 * `crear_contrato` con cuidado (ver useEditarContrato). Si alguno de
 * esos tres está mal, la vía correcta sigue siendo finalizar/eliminar
 * este contrato y crear uno nuevo.
 *
 * Reutiliza el mismo motor de cálculo por tarifa diaria diferenciada que
 * el wizard de creación (src/lib/calculo-credito.ts) — nunca se duplica
 * esa lógica.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft, Save, Calculator } from "lucide-react";
import { soles, type FrecuenciaPago } from "@/lib/supabase";
import { useResumenContratoEdicion, useEditarContrato } from "@/features/contratos/hooks/use-contratos";
import {
  calcularMontoTotalPorTarifaDiaria,
  esDuracionMesesValida,
  esTarifaDiariaValida,
  redondear2,
  type ResultadoCalculoTotal,
} from "@/lib/calculo-credito";
import { cn, mensajeError } from "@/lib/utils";

const FRECUENCIAS: { id: FrecuenciaPago; label: string }[] = [
  { id: "diario", label: "Diario" },
  { id: "semanal", label: "Semanal" },
  { id: "quincenal", label: "Quincenal" },
  { id: "mensual", label: "Mensual" },
];

const campo =
  "mt-1 w-full rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-grafito focus-visible:outline-2 focus-visible:outline-amarillo";
const etiqueta = "text-[11px] font-semibold uppercase tracking-widest text-grafito/40";

export default function EditarContrato({ contratoId }: { contratoId: string }) {
  const router = useRouter();
  const resumen = useResumenContratoEdicion(contratoId);
  const editar = useEditarContrato();

  const [montoTotal, setMontoTotal] = useState("");
  const [montoCuota, setMontoCuota] = useState("");
  const [frecuencia, setFrecuencia] = useState<FrecuenciaPago>("diario");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [modoTotal, setModoTotal] = useState<"manual" | "automatico">("manual");
  const [duracionMeses, setDuracionMeses] = useState("");
  const [tarifaLunSab, setTarifaLunSab] = useState("28");
  const [tarifaDomingo, setTarifaDomingo] = useState("10");
  const [cargado, setCargado] = useState(false);

  // Precarga UNA sola vez, apenas llega el resumen — nunca de nuevo en un
  // refetch posterior, para no pisar en silencio lo que el asesor ya
  // esté corrigiendo en pantalla.
  useEffect(() => {
    const r = resumen.data;
    if (!r || cargado) return;
    setMontoTotal(String(r.monto_total));
    setMontoCuota(String(r.monto_cuota));
    setFrecuencia(r.frecuencia_pago);
    setFechaInicio(r.fecha_inicio);
    setFechaFin(r.fecha_fin ?? "");
    if (r.duracion_meses && r.monto_lunes_sabado && r.monto_domingo) {
      setModoTotal("automatico");
      setDuracionMeses(String(r.duracion_meses));
      setTarifaLunSab(String(r.monto_lunes_sabado));
      setTarifaDomingo(String(r.monto_domingo));
    }
    setCargado(true);
  }, [resumen.data, cargado]);

  const r = resumen.data;
  const esVentaCredito = r?.tipo === "venta_credito";
  const modoAutomaticoActivo = esVentaCredito && modoTotal === "automatico";

  const duracionValida = esDuracionMesesValida(duracionMeses);
  const tarifasValidas = esTarifaDiariaValida(tarifaLunSab) && esTarifaDiariaValida(tarifaDomingo);

  let calculoAutomatico: ResultadoCalculoTotal | null = null;
  let errorCalculoAutomatico: string | null = null;
  if (modoAutomaticoActivo && duracionValida && tarifasValidas && fechaInicio.trim() !== "") {
    try {
      calculoAutomatico = calcularMontoTotalPorTarifaDiaria(
        fechaInicio,
        Number(duracionMeses),
        Number(tarifaLunSab),
        Number(tarifaDomingo),
      );
    } catch (err) {
      errorCalculoAutomatico = err instanceof Error ? err.message : "No se pudo calcular el monto total.";
    }
  }

  // Igual que en el wizard de creación: "Monto total" y "Monto por
  // cuota" dejan de pedirse a mano en modo automático — se calculan
  // solos (monto_cuota toma la tarifa Lunes-Sábado como referencia de
  // mora; el domingo se cobra aparte, a su propia tarifa).
  //
  // El cálculo por tarifa diaria es PURO (días × tarifa) — no sabe nada
  // de la cuota inicial, ya pagada y NO editable aquí. Pero "Monto
  // total" en todo el resto del sistema (saldo, cuotas estimadas)
  // siempre representa el precio COMPLETO incluida la inicial — por eso
  // se suma aquí antes de guardar, igual que en el wizard de creación:
  // si no, la cuota inicial se restaría dos veces y encogería de más el
  // cronograma financiado que en realidad queda.
  useEffect(() => {
    if (modoAutomaticoActivo && calculoAutomatico) {
      const inicial = r?.cuota_inicial ?? 0;
      setMontoTotal(String(redondear2(calculoAutomatico.montoTotal + inicial)));
      setMontoCuota(tarifaLunSab);
      setFechaFin(calculoAutomatico.fechaFin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoAutomaticoActivo, calculoAutomatico?.montoTotal, calculoAutomatico?.fechaFin, tarifaLunSab, r?.cuota_inicial]);

  const nTotal = Number.parseFloat(montoTotal);
  const nCuota = Number.parseFloat(montoCuota);
  const valido =
    (!esVentaCredito || modoTotal === "manual" || (calculoAutomatico !== null && !errorCalculoAutomatico)) &&
    Number.isFinite(nTotal) && nTotal > 0 &&
    Number.isFinite(nCuota) && nCuota > 0 &&
    fechaInicio.trim() !== "" &&
    (fechaFin.trim() === "" || fechaFin >= fechaInicio);

  function guardar() {
    if (!valido) return;
    editar.mutate(
      {
        contratoId,
        montoTotal: nTotal,
        montoCuota: nCuota,
        frecuencia,
        fechaInicio,
        fechaFin: fechaFin.trim() || undefined,
        duracionMeses: modoAutomaticoActivo ? Number(duracionMeses) : undefined,
        montoLunesSabado: modoAutomaticoActivo ? Number(tarifaLunSab) : undefined,
        montoDomingo: modoAutomaticoActivo ? Number(tarifaDomingo) : undefined,
      },
      { onSuccess: () => router.push(`/contratos/${contratoId}`) },
    );
  }

  if (resumen.isLoading) {
    return (
      <div className="mx-auto max-w-md space-y-3 p-4 sm:p-6">
        <div className="h-8 w-40 animate-pulse rounded-xl bg-borde/60" />
        <div className="h-64 animate-pulse rounded-2xl bg-borde/60" />
      </div>
    );
  }

  if (!r) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-sm text-oxido">No se pudo cargar el contrato.</p>
      </div>
    );
  }

  if (r.estado === "finalizado") {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6 text-center">
        <p className="text-sm text-grafito/60">
          Un contrato ya finalizado no se puede editar — el registro histórico no se modifica.
        </p>
        <button
          type="button"
          onClick={() => router.push(`/contratos/${contratoId}`)}
          className="rounded-xl bg-amarillo px-4 py-2.5 font-bold text-grafito"
        >
          Volver al contrato
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md space-y-5 p-4 sm:p-6"
    >
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.push(`/contratos/${contratoId}`)}
          aria-label="Volver"
          className="rounded-lg p-1.5 text-grafito/40 hover:bg-fondo"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-black uppercase tracking-tight text-grafito">Editar contrato</h1>
      </header>

      <div className="rounded-2xl border border-borde bg-tarjeta p-3 text-sm shadow-card">
        <p className="font-semibold text-grafito">{r.cliente_nombre}</p>
        <p className="text-xs text-grafito/50">
          Placa <span className="font-mono font-bold">{r.vehiculo_placa}</span> ·{" "}
          {r.tipo === "alquiler" ? "Alquiler" : "Venta a crédito"}
        </p>
      </div>

      <p className="rounded-xl bg-fondo p-3 text-xs text-grafito/50">
        Cliente, vehículo y tipo de contrato no se pueden cambiar aquí — si alguno está equivocado,
        finaliza este contrato y crea uno nuevo con los datos correctos.
      </p>

      {esVentaCredito && (
        <div className="space-y-3 rounded-2xl border border-borde bg-fondo p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-grafito/40">
            <Calculator className="h-3.5 w-3.5" /> Cálculo del monto total
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "manual", label: "Manual" },
                { id: "automatico", label: "Tarifa diaria" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={modoTotal === m.id}
                onClick={() => setModoTotal(m.id)}
                className={cn(
                  "rounded-xl border py-2.5 text-xs font-bold transition-colors",
                  modoTotal === m.id ? "border-cobre bg-cobre/10 text-cobre" : "border-borde text-grafito/50",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {modoTotal === "automatico" && (
            <div className="space-y-3">
              <div>
                <label htmlFor="duracion-e" className={etiqueta}>
                  Duración del contrato (meses)
                </label>
                <input
                  id="duracion-e"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={duracionMeses}
                  onChange={(e) => setDuracionMeses(e.target.value)}
                  className={cn(campo, "font-bold tabular-nums")}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="tls-e" className={etiqueta}>
                    Lunes–Sábado (S/./día)
                  </label>
                  <input
                    id="tls-e"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.10"
                    value={tarifaLunSab}
                    onChange={(e) => setTarifaLunSab(e.target.value)}
                    className={cn(campo, "font-bold tabular-nums")}
                  />
                </div>
                <div>
                  <label htmlFor="td-e" className={etiqueta}>
                    Domingo (S/./día)
                  </label>
                  <input
                    id="td-e"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.10"
                    value={tarifaDomingo}
                    onChange={(e) => setTarifaDomingo(e.target.value)}
                    className={cn(campo, "font-bold tabular-nums")}
                  />
                </div>
              </div>

              {calculoAutomatico ? (
                <p className="rounded-xl bg-amarillo/10 p-3 text-xs text-grafito">
                  {calculoAutomatico.diasLunesSabado} días L–S × {soles.format(Number(tarifaLunSab))} +{" "}
                  {calculoAutomatico.diasDomingo} domingos × {soles.format(Number(tarifaDomingo))} ={" "}
                  <span className="font-black">{soles.format(redondear2(calculoAutomatico.montoTotal))}</span>{" "}
                  de cronograma financiado
                  {(r?.cuota_inicial ?? 0) > 0 && (
                    <>
                      {" "}
                      + {soles.format(r!.cuota_inicial)} de cuota inicial ya pagada ={" "}
                      <span className="font-black">
                        {soles.format(redondear2(calculoAutomatico.montoTotal + (r?.cuota_inicial ?? 0)))}
                      </span>{" "}
                      de monto total del contrato
                    </>
                  )}
                  . Fin:{" "}
                  <span className="font-black">
                    {new Date(`${calculoAutomatico.fechaFin}T12:00:00`).toLocaleDateString("es-PE")}
                  </span>
                  .
                </p>
              ) : (
                <p className="text-xs text-oxido">
                  {errorCalculoAutomatico ?? "Ingresa la duración y ambas tarifas (mayores a cero)."}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!modoAutomaticoActivo && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label htmlFor="total-e" className={etiqueta}>
              Monto total del contrato (S/.)
            </label>
            <input
              id="total-e"
              type="number"
              inputMode="decimal"
              min="0"
              value={montoTotal}
              onChange={(e) => setMontoTotal(e.target.value)}
              className={cn(campo, "text-xl font-black tabular-nums")}
            />
          </div>
          <div className="col-span-2">
            <label htmlFor="cuota-e" className={etiqueta}>
              Monto por cuota
            </label>
            <input
              id="cuota-e"
              type="number"
              inputMode="decimal"
              min="0"
              value={montoCuota}
              onChange={(e) => setMontoCuota(e.target.value)}
              className={cn(campo, "font-bold tabular-nums")}
            />
          </div>
        </div>
      )}

      <fieldset>
        <legend className={etiqueta}>Frecuencia de pago</legend>
        <div className="mt-1 grid grid-cols-4 gap-2">
          {FRECUENCIAS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={frecuencia === f.id}
              onClick={() => setFrecuencia(f.id)}
              className={cn(
                "rounded-xl border py-2.5 text-xs font-semibold transition-colors",
                frecuencia === f.id ? "border-cobre bg-cobre/10 text-cobre" : "border-borde text-grafito/50",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </fieldset>

      {/* `grid-cols-1 sm:grid-cols-2` (a diferencia del grid fijo de
          tarifas, que nunca apila): un `<input type="date">` trae su
          propio ícono de calendario + "DD/MM/AAAA" nativo del sistema
          operativo, con un ancho mínimo que un grid NO encoge por
          defecto (`min-width: auto` en un hijo de grid) — a diferencia
          de un `<input type="number">` (tarifas), que sí se achica sin
          problema. En un teléfono angosto, esa columna de 2 no le
          alcanza al widget nativo y se monta sobre la columna vecina.
          `min-w-0` en cada celda es la red de seguridad (permite que el
          grid SÍ la encoja si hiciera falta); apilar en columna única
          por debajo de `sm:` evita el problema de raíz en el caso real
          — un celular — y solo pasa a 2 columnas en pantallas con
          espacio de sobra (tablet/escritorio). El estilo de cada label
          + input es exactamente el mismo que el de las tarifas
          Lunes–Sábado / Domingo (mismas clases `etiqueta`/`campo`). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor="inicio-e" className={etiqueta}>
            Fecha de inicio
          </label>
          <input
            id="inicio-e"
            type="date"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
            className={campo}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="fin-e" className={etiqueta}>
            Fecha de fin {modoAutomaticoActivo && "(automática)"}
          </label>
          <input
            id="fin-e"
            type="date"
            readOnly={modoAutomaticoActivo}
            value={fechaFin}
            onChange={(e) => setFechaFin(e.target.value)}
            className={cn(campo, modoAutomaticoActivo && "bg-borde/30")}
          />
        </div>
      </div>

      {editar.isError && (
        <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">
          {mensajeError(editar.error, "No se pudo guardar el contrato. Intenta de nuevo.")}
        </p>
      )}

      <button
        type="button"
        disabled={!valido || editar.isPending}
        onClick={guardar}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amarillo py-4 font-bold text-grafito active:scale-[0.98] disabled:opacity-40"
      >
        {editar.isPending ? (
          "Guardando…"
        ) : (
          <>
            <Save className="h-5 w-5" strokeWidth={3} /> Guardar cambios
          </>
        )}
      </button>
    </motion.div>
  );
}
