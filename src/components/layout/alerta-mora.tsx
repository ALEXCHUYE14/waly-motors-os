"use client";

/**
 * WALY MOTORS OS — Alerta global de mora
 * ───────────────────────────────────────
 * Pedido: que el sistema avise si hay contratos en mora "según el
 * calendario", sin importar en qué pantalla esté el usuario — no solo
 * al entrar al Dashboard.
 *
 * Deliberadamente NO se agrega infraestructura de notificaciones push
 * (el proyecto no tiene service worker, permisos del navegador ni
 * claves VAPID): eso es un cambio grande y nuevo, con mucha más
 * superficie para bugs. En su lugar, se reutiliza el MISMO conteo que ya
 * calcula `kpis_dashboard` — que a su vez sale de
 * `obtener_clientes_en_mora` (migración 00023), la única fórmula de mora
 * de todo el sistema, la misma que ya pinta el calendario de pagos y la
 * sección "Acción urgente" del Dashboard. Nunca se recalcula aparte: si
 * la fórmula de mora cambia algún día, este banner cambia solo.
 *
 * Vive montado a nivel de app (mismo patrón que `AlertaCobrosFallidos`),
 * así que se ve desde Clientes, Vehículos, Contratos, etc. Se oculta
 * solo dentro de /dashboard (ahí ya está el detalle completo — mostrarlo
 * dos veces sería ruido) y cuando no hay nadie en mora.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { useKpis } from "@/features/dashboard/hooks/use-kpis";

export function AlertaMora() {
  const pathname = usePathname();
  const kpis = useKpis();
  const enMora = kpis.data?.clientes_en_mora ?? 0;

  // `kpis.isLoading`/`isError` se ignoran a propósito: mientras no haya
  // un número confirmado (> 0), el banner simplemente no aparece — nunca
  // se muestra un aviso de mora basado en un dato que todavía no llegó o
  // que falló al cargar.
  if (pathname.startsWith("/dashboard") || enMora === 0) return null;

  return (
    <Link
      href="/dashboard"
      role="alert"
      className="flex items-center gap-2 border-b border-oxido/30 bg-oxido/10 px-4 py-2.5 text-sm font-semibold text-oxido"
    >
      <TriangleAlert className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        {enMora === 1
          ? "1 cliente tiene una cuota vencida según el calendario de pagos."
          : `${enMora} clientes tienen cuotas vencidas según el calendario de pagos.`}
      </span>
      <span className="shrink-0 whitespace-nowrap underline underline-offset-2">Ver detalle</span>
    </Link>
  );
}
