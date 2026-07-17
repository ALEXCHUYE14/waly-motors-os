"use client";

/**
 * WALY MOTORS OS — Pestaña de Mantenimiento (dentro del formulario de vehículo)
 * ──────────────────────────────────────────────────────────────────────────
 * Historial de servicios + alta de un nuevo registro. El RPC
 * `registrar_mantenimiento` también actualiza el kilometraje del
 * vehículo si el km informado es mayor al actual (misma fuente de
 * verdad que la lectura del odómetro en el taller).
 */

import { useState } from "react";
import { Check, Gauge, Wrench } from "lucide-react";
import { soles } from "@/lib/supabase";
import {
  useMantenimientos,
  useRegistrarMantenimiento,
  type TipoMantenimiento,
} from "@/features/vehiculos/hooks/use-vehiculos";
import { cn } from "@/lib/utils";

const TIPOS: { id: TipoMantenimiento; label: string }[] = [
  { id: "preventivo", label: "Preventivo" },
  { id: "correctivo", label: "Correctivo" },
  { id: "llantas", label: "Llantas" },
  { id: "motor", label: "Motor" },
  { id: "otro", label: "Otro" },
];

const fechaCorta = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric" });

export function TabMantenimiento({
  vehiculoId,
  kilometrajeActual,
}: {
  vehiculoId: string;
  kilometrajeActual: number;
}) {
  const historial = useMantenimientos(vehiculoId);
  const registrar = useRegistrarMantenimiento(vehiculoId);

  const [tipo, setTipo] = useState<TipoMantenimiento>("preventivo");
  const [descripcion, setDescripcion] = useState("");
  const [costo, setCosto] = useState("");
  const [kmServicio, setKmServicio] = useState(String(kilometrajeActual || 0));
  const [fechaServicio, setFechaServicio] = useState(() => new Date().toISOString().slice(0, 10));
  const [proximoKm, setProximoKm] = useState("");
  const [proximoFecha, setProximoFecha] = useState("");

  const valido = Number(kmServicio) >= 0 && fechaServicio.length === 10;

  function onRegistrar() {
    if (!valido) return;
    registrar.mutate(
      {
        tipo,
        descripcion,
        costo: costo ? Number(costo) : null,
        kilometrajeServicio: Number(kmServicio),
        fechaServicio,
        proximoKm: proximoKm ? Number(proximoKm) : null,
        proximoFecha: proximoFecha || null,
      },
      {
        onSuccess: () => {
          setDescripcion("");
          setCosto("");
          setProximoKm("");
          setProximoFecha("");
        },
      },
    );
  }

  const campo =
    "mt-1 w-full rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-grafito focus-visible:outline-2 focus-visible:outline-amarillo";
  const etiqueta = "text-[11px] font-semibold uppercase tracking-widest text-grafito/40";

  return (
    <div className="space-y-5">
      {/* Formulario de alta */}
      <div className="space-y-3 rounded-2xl border border-borde bg-tarjeta p-4 shadow-card">
        <p className="text-sm font-black uppercase tracking-wide text-grafito">Registrar servicio</p>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {TIPOS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tipo === t.id}
              onClick={() => setTipo(t.id)}
              className={cn(
                "rounded-xl border py-2 text-xs font-semibold",
                tipo === t.id ? "border-cobre bg-cobre/10 text-cobre" : "border-borde text-grafito/50",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div>
          <label className={etiqueta} htmlFor="desc-mant">Descripción</label>
          <input
            id="desc-mant"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Cambio de aceite y filtro"
            className={campo}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={etiqueta} htmlFor="km-mant">Km al servicio</label>
            <input id="km-mant" type="number" inputMode="numeric" value={kmServicio} onChange={(e) => setKmServicio(e.target.value)} className={campo} />
          </div>
          <div>
            <label className={etiqueta} htmlFor="fecha-mant">Fecha</label>
            <input id="fecha-mant" type="date" value={fechaServicio} onChange={(e) => setFechaServicio(e.target.value)} className={campo} />
          </div>
          <div>
            <label className={etiqueta} htmlFor="costo-mant">Costo S/. (opcional)</label>
            <input id="costo-mant" type="number" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} className={campo} />
          </div>
          <div>
            <label className={etiqueta} htmlFor="prox-km">Próximo servicio (km)</label>
            <input id="prox-km" type="number" inputMode="numeric" value={proximoKm} onChange={(e) => setProximoKm(e.target.value)} placeholder="Opcional" className={campo} />
          </div>
          <div className="col-span-2">
            <label className={etiqueta} htmlFor="prox-fecha">Próximo servicio (fecha)</label>
            <input id="prox-fecha" type="date" value={proximoFecha} onChange={(e) => setProximoFecha(e.target.value)} className={campo} />
          </div>
        </div>

        {registrar.isError && (
          <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">
            No se pudo registrar el servicio. Intenta de nuevo.
          </p>
        )}

        <button
          type="button"
          disabled={!valido || registrar.isPending}
          onClick={onRegistrar}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-amarillo py-3.5 font-bold text-grafito active:scale-[0.98] disabled:opacity-40"
        >
          {registrar.isPending ? "Guardando…" : <><Check className="h-5 w-5" strokeWidth={3} /> Registrar</>}
        </button>
      </div>

      {/* Historial */}
      <div className="space-y-2">
        <p className="text-sm font-black uppercase tracking-wide text-grafito">Historial</p>
        {historial.isLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-borde/60" />)}
          </div>
        ) : historial.data && historial.data.length > 0 ? (
          <ul className="space-y-2">
            {historial.data.map((m) => (
              <li key={m.id} className="rounded-2xl border border-borde bg-tarjeta p-3 shadow-card">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cobre/10 text-cobre">
                    <Wrench className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-grafito">
                      {TIPOS.find((t) => t.id === m.tipo)?.label ?? m.tipo}
                      {m.descripcion && <span className="font-normal text-grafito/60"> · {m.descripcion}</span>}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-grafito/50">
                      {fechaCorta.format(new Date(`${m.fecha_servicio}T12:00:00`))}
                      <Gauge className="ml-1.5 h-3 w-3" /> {m.kilometraje_servicio.toLocaleString("es-PE")} km
                      {m.costo != null && ` · ${soles.format(m.costo)}`}
                    </p>
                  </div>
                </div>
                {(m.proximo_km || m.proximo_fecha) && (
                  <p className="mt-2 rounded-lg bg-fondo px-2.5 py-1.5 text-[11px] text-grafito/60">
                    Próximo:{" "}
                    {m.proximo_km && `${m.proximo_km.toLocaleString("es-PE")} km`}
                    {m.proximo_km && m.proximo_fecha && " · "}
                    {m.proximo_fecha && fechaCorta.format(new Date(`${m.proximo_fecha}T12:00:00`))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-borde p-4 text-center text-sm text-grafito/50">
            Sin servicios registrados todavía.
          </p>
        )}
      </div>
    </div>
  );
}
