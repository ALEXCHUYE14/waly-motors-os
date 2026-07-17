"use client";

/**
 * WALY MOTORS OS — Hooks de contratos
 * TanStack Query sobre las RPCs de la migración 00003.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, type FrecuenciaPago, type EstadoVehiculo } from "@/lib/supabase";
import { urlFirmadas } from "@/lib/utils";

// ── Tipos ────────────────────────────────────────────────────
export interface VehiculoDisponible {
  id: string;
  placa: string;
  modelo: string;
  anio: number;
  estado: EstadoVehiculo;
  precio_alquiler_diario: number | null;
  precio_venta: number | null;
  kilometraje: number;
  fotos: string[];
}

export interface ClienteBasico {
  id: string;
  nombre_completo: string;
  numero_documento: string;
  telefono: string | null;
  foto_perfil: string | null;
}

export interface NuevoContrato {
  clienteId: string;
  vehiculoId: string;
  tipo: "alquiler" | "venta_credito";
  montoTotal: number;
  cuotaInicial: number;
  montoCuota: number;
  frecuencia: FrecuenciaPago;
  diaPagoPreferido?: number;
  fechaInicio: string; // ISO date
  fechaFin?: string;
}

// ── Vehículos disponibles ────────────────────────────────────
export function useVehiculosDisponibles() {
  return useQuery({
    queryKey: ["vehiculos-disponibles"],
    queryFn: async (): Promise<VehiculoDisponible[]> => {
      const { data, error } = await supabase.rpc("vehiculos_disponibles");
      if (error) throw error;

      const vehiculos = (data ?? []) as VehiculoDisponible[];

      // Solo la portada de cada vehículo, firmada en una sola llamada
      // (bucket `vehiculos` es privado — no se puede exponer la ruta cruda).
      const portadas = vehiculos.map((v) => v.fotos?.[0]).filter(Boolean) as string[];
      const urlPorRuta = await urlFirmadas("vehiculos", portadas);

      return vehiculos.map((v) => {
        const url = v.fotos?.[0] ? urlPorRuta.get(v.fotos[0]) : undefined;
        return { ...v, fotos: url ? [url] : [] };
      });
    },
  });
}

// ── Búsqueda de clientes (para el paso 1 del wizard) ─────────
export function useBuscarClientes(termino: string) {
  const [debounced, setDebounced] = useState(termino);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(termino), 300);
    return () => clearTimeout(t);
  }, [termino]);

  return useQuery({
    queryKey: ["buscar-clientes", debounced],
    enabled: debounced.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<ClienteBasico[]> => {
      const q = debounced.trim();
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nombre_completo, numero_documento, telefono, foto_perfil")
        .or(`nombre_completo.ilike.%${q}%,numero_documento.like.${q}%`)
        .limit(8);
      if (error) throw error;

      // Bucket `clientes` es privado — firmar antes de exponer al UI.
      const rutas = (data ?? []).map((c) => c.foto_perfil).filter(Boolean) as string[];
      const urlPorRuta = await urlFirmadas("clientes", rutas);

      return (data ?? []).map((c) => ({
        ...c,
        foto_perfil: c.foto_perfil ? urlPorRuta.get(c.foto_perfil) ?? null : null,
      }));
    },
  });
}

// ── Crear contrato (RPC atómica) ─────────────────────────────
export function useCrearContrato() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (c: NuevoContrato) => {
      const { data, error } = await supabase.rpc("crear_contrato", {
        p_cliente_id: c.clienteId,
        p_vehiculo_id: c.vehiculoId,
        p_tipo: c.tipo,
        p_monto_total: c.montoTotal,
        p_cuota_inicial: c.cuotaInicial,
        p_monto_cuota: c.montoCuota,
        p_frecuencia_pago: c.frecuencia,
        p_dia_pago_preferido: c.diaPagoPreferido ?? null,
        p_fecha_inicio: c.fechaInicio,
        p_fecha_fin: c.fechaFin ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehiculos-disponibles"] });
      void queryClient.invalidateQueries({ queryKey: ["vehiculos"] });
      void queryClient.invalidateQueries({ queryKey: ["kpis-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["clientes-en-mora"] });
    },
  });
}

// ── Finalizar contrato ───────────────────────────────────────
export function useFinalizarContrato() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (contratoId: string) => {
      const { data, error } = await supabase.rpc("finalizar_contrato", {
        p_contrato_id: contratoId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehiculos-disponibles"] });
      void queryClient.invalidateQueries({ queryKey: ["vehiculos"] });
      void queryClient.invalidateQueries({ queryKey: ["kpis-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["clientes-en-mora"] });
    },
  });
}
