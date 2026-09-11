"use client";

/**
 * WALY MOTORS OS — KPIs del día (RPC `kpis_dashboard`)
 * ─────────────────────────────────────────────────────
 * Extraído de `dashboard.tsx` para que el mismo dato — sobre todo
 * `clientes_en_mora` — se comparta entre el Dashboard y el resto del
 * app shell (badge de mora en la navegación, banner global de mora,
 * ver `alerta-mora.tsx`). Misma `queryKey` en todos lados
 * (`["kpis-dashboard"]`): TanStack Query la deduplica en un solo caché,
 * así que montar este hook en varios componentes a la vez NO dispara
 * pedidos repetidos — y el número de mora nunca puede quedar
 * desincronizado entre pantallas, porque es literalmente el mismo dato.
 *
 * Se invalida en tiempo real desde `useSincronizacionRealtime`
 * (app-shell.tsx) al cambiar `pagos`/`contratos`, más un refetch cada
 * 60s como red de seguridad si el realtime se cae.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase, type KpisDashboard } from "@/lib/supabase";

export function useKpis() {
  return useQuery({
    queryKey: ["kpis-dashboard"],
    queryFn: async (): Promise<KpisDashboard> => {
      const { data, error } = await supabase.rpc("kpis_dashboard");
      if (error) throw error;
      return data as KpisDashboard;
    },
    refetchInterval: 60_000,
  });
}
