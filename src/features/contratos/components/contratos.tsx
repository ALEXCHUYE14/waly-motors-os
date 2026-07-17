"use client";

/**
 * WALY MOTORS OS — Módulo Contratos (listado)
 * Filtro por estado + tarjeta por contrato con cliente, vehículo
 * y cuota. Tap → detalle del contrato. "+" → wizard de alta.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, KeyRound, Plus } from "lucide-react";
import { soles, type FrecuenciaPago } from "@/lib/supabase";
import {
  useContratos,
  type ContratoResumen,
  type EstadoContrato,
} from "@/features/contratos/hooks/use-contratos";
import { cn } from "@/lib/utils";

const ESTADOS: { id: EstadoContrato | "todos"; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "activo", label: "Activos" },
  { id: "vencido", label: "Vencidos" },
  { id: "finalizado", label: "Finalizados" },
];

const COLOR_ESTADO: Record<EstadoContrato, string> = {
  activo: "bg-emerald-500/15 text-emerald-600",
  vencido: "bg-oxido/15 text-oxido",
  finalizado: "bg-grafito/10 text-grafito/60",
};

const LABEL_ESTADO: Record<EstadoContrato, string> = {
  activo: "Activo",
  vencido: "Vencido",
  finalizado: "Finalizado",
};

const LABEL_FRECUENCIA: Record<FrecuenciaPago, string> = {
  diario: "diario",
  semanal: "semanal",
  quincenal: "quincenal",
  mensual: "mensual",
};

export function ListaContratos() {
  const router = useRouter();
  const [filtro, setFiltro] = useState<EstadoContrato | "todos">("activo");
  const contratos = useContratos(filtro);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-black uppercase tracking-tight text-grafito">Contratos</h1>
        <button
          type="button"
          onClick={() => router.push("/contratos/nuevo")}
          className="flex items-center gap-1.5 rounded-xl bg-cobre px-4 py-2.5 text-sm font-bold text-white active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" strokeWidth={3} /> Nuevo
        </button>
      </header>

      {/* Filtros */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {ESTADOS.map((e) => (
          <button
            key={e.id}
            type="button"
            aria-pressed={filtro === e.id}
            onClick={() => setFiltro(e.id)}
            className={cn(
              "shrink-0 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors",
              filtro === e.id ? "border-cobre bg-cobre/10 text-cobre" : "border-borde text-grafito/50",
            )}
          >
            {e.label}
          </button>
        ))}
      </div>

      {contratos.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-borde/60" />)}
        </div>
      ) : contratos.data && contratos.data.length > 0 ? (
        <ul className="space-y-2">
          {contratos.data.map((c) => (
            <TarjetaContrato key={c.id} contrato={c} onAbrir={() => router.push(`/contratos/${c.id}`)} />
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-borde p-6 text-center text-sm text-grafito/50">
          No hay contratos en este filtro.
        </p>
      )}
    </div>
  );
}

function TarjetaContrato({ contrato: c, onAbrir }: { contrato: ContratoResumen; onAbrir: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        className="flex w-full items-center gap-3 rounded-2xl border border-borde bg-tarjeta p-3.5 text-left shadow-card active:scale-[0.99]"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cobre/10 text-cobre">
          {c.tipo === "alquiler" ? <KeyRound className="h-5 w-5" /> : <FileSignature className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-grafito">
            {c.clientes?.nombre_completo ?? "Cliente eliminado"}
          </span>
          <span className="block text-xs text-grafito/50">
            <span className="font-mono font-bold">{c.vehiculos?.placa ?? "—"}</span>
            {c.vehiculos?.modelo && ` · ${c.vehiculos.modelo}`} · {soles.format(c.monto_cuota)}{" "}
            {LABEL_FRECUENCIA[c.frecuencia_pago]}
          </span>
        </span>
        <span className={cn("shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold", COLOR_ESTADO[c.estado])}>
          {LABEL_ESTADO[c.estado]}
        </span>
      </button>
    </li>
  );
}
