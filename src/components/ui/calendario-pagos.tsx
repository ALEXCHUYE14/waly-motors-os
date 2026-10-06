"use client";

/**
 * WALY MOTORS OS — Calendario de pagos
 * ──────────────────────────────────────
 * Grilla mensual para el detalle de un contrato. No calcula nada: pinta
 * los días que `cronograma_contrato` (migración 00032) marca como
 * cubiertos (VERDE, o AZUL si el día es domingo) y los días en mora
 * (ROJO). Así el calendario y el cálculo de mora de la sección "Acción
 * urgente" nunca pueden discrepar.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const DIAS_SEMANA = ["D", "L", "M", "M", "J", "V", "S"];
const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export interface CalendarioPagosProps {
  /** Días `YYYY-MM-DD` del cronograma ya cubiertos por los pagos (al día),
   *  según `cronograma_contrato` (migración 00032). */
  diasCubiertos: Set<string>;
  /** Días `YYYY-MM-DD` del cronograma en mora (vencidos e impagos). */
  diasMora: Set<string>;
  /** Mes a mostrar al abrir (cualquier fecha `YYYY-MM-DD` de ese mes) —
   *  por defecto, el mes actual. */
  mesInicial?: string;
}

function aISO(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function CalendarioPagos({ diasCubiertos, diasMora, mesInicial }: CalendarioPagosProps) {
  let base: Date;
  try {
    base = mesInicial ? new Date(`${mesInicial}T12:00:00`) : new Date();
    if (Number.isNaN(base.getTime())) base = new Date();
  } catch {
    base = new Date();
  }

  const [anioVisible, setAnioVisible] = useState(base.getFullYear());
  const [mesVisible, setMesVisible] = useState(base.getMonth()); // 0-11

  const hoy = new Date();
  const hoyISO = aISO(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());

  const primerDiaSemana = new Date(anioVisible, mesVisible, 1).getDay(); // 0 = domingo
  const diasEnMes = new Date(anioVisible, mesVisible + 1, 0).getDate();
  const celdas: (number | null)[] = [
    ...Array.from({ length: primerDiaSemana }, () => null),
    ...Array.from({ length: diasEnMes }, (_, i) => i + 1),
  ];

  function cambiarMes(delta: number) {
    let m = mesVisible + delta;
    let a = anioVisible;
    if (m < 0) {
      m = 11;
      a -= 1;
    } else if (m > 11) {
      m = 0;
      a += 1;
    }
    setMesVisible(m);
    setAnioVisible(a);
  }

  return (
    <div className="rounded-2xl border border-borde bg-tarjeta p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => cambiarMes(-1)}
          aria-label="Mes anterior"
          className="rounded-lg p-1.5 text-grafito/40 hover:bg-fondo"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-black uppercase tracking-wide text-grafito">
          {MESES[mesVisible]} {anioVisible}
        </p>
        <button
          type="button"
          onClick={() => cambiarMes(1)}
          aria-label="Mes siguiente"
          className="rounded-lg p-1.5 text-grafito/40 hover:bg-fondo"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {DIAS_SEMANA.map((d, i) => (
          <span key={i} className="text-[10px] font-bold uppercase text-grafito/30">
            {d}
          </span>
        ))}
        {celdas.map((dia, i) => {
          if (dia === null) return <span key={`v-${i}`} />;
          const iso = aISO(anioVisible, mesVisible, dia);
          // Cubierto = el cronograma del servidor confirma que este día
          // quedó pagado (ya incluye montos y cobros adelantados).
          const tienePago = diasCubiertos.has(iso);
          // 0 = domingo (mismo criterio que `primerDiaSemana` arriba) —
          // se calcula con los mismos enteros de la grilla, nunca
          // parseando `iso` como fecha, para no arrastrar ningún lío de
          // huso horario a un simple "¿qué día de la semana es?".
          const esDomingo = new Date(anioVisible, mesVisible, dia).getDay() === 0;
          const pagoDomingo = tienePago && esDomingo;
          const enMora = diasMora.has(iso);
          const esHoy = iso === hoyISO;
          return (
            <span
              key={iso}
              title={
                pagoDomingo
                  ? "Pago registrado en domingo"
                  : tienePago
                    ? "Pago registrado"
                    : enMora
                      ? "Día en mora"
                      : undefined
              }
              className={cn(
                "mx-auto grid h-8 w-8 place-items-center rounded-lg text-xs font-semibold",
                pagoDomingo
                  ? "bg-sky-500/15 text-sky-600"
                  : tienePago
                    ? "bg-emerald-500/15 text-emerald-600"
                    : enMora
                      ? "bg-oxido/15 text-oxido"
                      : "text-grafito/60",
                esHoy && "ring-2 ring-amarillo ring-inset",
              )}
            >
              {dia}
            </span>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-grafito/50">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Pago registrado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> Pago en domingo
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-oxido" /> En mora
        </span>
      </div>
    </div>
  );
}
