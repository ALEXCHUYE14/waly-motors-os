"use client";

/**
 * WALY MOTORS OS — Calendario de pagos
 * ──────────────────────────────────────
 * Grilla mensual con navegación, para el detalle de un contrato: marca
 * en VERDE los días con al menos un pago real registrado, en AZUL los
 * pagos registrados en DOMINGO (mismo dato — `fechasConPago` — solo que
 * el día de la semana de esa fecha cae domingo; ver `esDomingo` más
 * abajo, no depende de ninguna columna nueva ni de ningún cálculo del
 * backend), y en ROJO el tramo de mora activa — desde
 * `proximo_vencimiento` (la próxima cuota que se venció sin pagar,
 * misma fórmula exacta que ya usan `obtener_clientes_en_mora` y
 * `resumen_contrato`, migración 00023) hasta hoy. Nunca se recalcula la
 * mora por separado aquí: solo pinta lo que ya calculó el backend, para
 * que jamás quede desincronizada con la sección "Acción urgente" del
 * dashboard. Al ser puramente visual y derivarse de datos que ya
 * existen (la fecha del pago), el color de domingo aparece solo con
 * volver a abrir el calendario — no requiere ninguna migración ni
 * recálculo para los pagos de domingo ya registrados.
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
  /** Fechas `YYYY-MM-DD` (en hora local, ya resueltas por el llamador)
   *  con al menos un pago registrado ese día. */
  fechasConPago: Set<string>;
  /** Fecha `YYYY-MM-DD` desde la que el contrato está en mora, o `null`
   *  si está al día — normalmente `proximo_vencimiento` cuando
   *  `dias_retraso > 0`. */
  inicioMora: string | null;
  /** Mes a mostrar al abrir (cualquier fecha `YYYY-MM-DD` de ese mes) —
   *  por defecto, el mes actual. */
  mesInicial?: string;
}

function aISO(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function CalendarioPagos({ fechasConPago, inicioMora, mesInicial }: CalendarioPagosProps) {
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
          const tienePago = fechasConPago.has(iso);
          // 0 = domingo (mismo criterio que `primerDiaSemana` arriba) —
          // se calcula con los mismos enteros de la grilla, nunca
          // parseando `iso` como fecha, para no arrastrar ningún lío de
          // huso horario a un simple "¿qué día de la semana es?".
          const esDomingo = new Date(anioVisible, mesVisible, dia).getDay() === 0;
          const pagoDomingo = tienePago && esDomingo;
          const enMora = inicioMora !== null && iso >= inicioMora && iso <= hoyISO;
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
