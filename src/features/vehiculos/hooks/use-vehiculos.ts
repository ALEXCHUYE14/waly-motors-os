"use client";

/**
 * WALY MOTORS OS — Hooks de vehículos
 * Listado con URLs firmadas, alta/edición y gestión de galería.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, type EstadoVehiculo } from "@/lib/supabase";
import { subirImagen, urlFirmadas } from "@/lib/utils";

// ── Tipos ────────────────────────────────────────────────────
export interface Vehiculo {
  id: string;
  placa: string;
  modelo: string;
  anio: number;
  numero_chasis: string;
  estado: EstadoVehiculo;
  precio_alquiler_diario: number | null;
  precio_venta: number | null;
  kilometraje: number;
  fotos: string[]; // rutas internas del bucket
  fotosFirmadas?: string[]; // URLs firmadas (solo cliente)
}

export interface DatosVehiculo {
  placa: string;
  modelo: string;
  anio: number;
  numeroChasis: string;
  precioAlquilerDiario: number | null;
  precioVenta: number | null;
  kilometraje: number;
  nuevasFotos: File[];
  fotosExistentes: string[]; // rutas que se conservan al editar
}

const invalidaciones = ["vehiculos", "vehiculos-disponibles", "kpis-dashboard"];

// ── Listado con firma de primera foto ────────────────────────
export function useVehiculos(filtroEstado?: EstadoVehiculo | "todos") {
  return useQuery({
    queryKey: ["vehiculos", filtroEstado ?? "todos"],
    // Las mutaciones (crear/finalizar contrato, cambiar estado, guardar)
    // ya invalidan esta key explícitamente, así que es seguro no refetchear
    // solo por volver a navegar a esta sección dentro de 1 minuto.
    staleTime: 60_000,
    queryFn: async (): Promise<Vehiculo[]> => {
      let q = supabase.from("vehiculos").select("*").order("placa");
      if (filtroEstado && filtroEstado !== "todos") q = q.eq("estado", filtroEstado);
      const { data, error } = await q;
      if (error) throw error;

      // Solo la portada de cada vehículo, pero UNA sola llamada HTTP para
      // toda la lista (antes: 1 llamada por vehículo → N requests).
      const portadas = (data ?? []).map((v) => v.fotos[0]).filter(Boolean) as string[];
      const urlPorRuta = await urlFirmadas("vehiculos", portadas);

      return (data ?? []).map((v) => {
        const url = v.fotos[0] ? urlPorRuta.get(v.fotos[0]) : undefined;
        return { ...v, fotosFirmadas: url ? [url] : [] };
      });
    },
  });
}

// ── Detalle con galería completa firmada ─────────────────────
export function useVehiculo(id: string) {
  return useQuery({
    queryKey: ["vehiculo", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<Vehiculo> => {
      const { data, error } = await supabase
        .from("vehiculos")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;

      const urlPorRuta = await urlFirmadas("vehiculos", data.fotos);
      const fotosFirmadas = data.fotos
        .map((r: string) => urlPorRuta.get(r))
        .filter((u: string | undefined): u is string => Boolean(u));

      return { ...data, fotosFirmadas };
    },
  });
}

// ── Crear / actualizar con subida de galería ─────────────────
export function useGuardarVehiculo(idExistente?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (d: DatosVehiculo) => {
      // 1. Subir fotos nuevas al bucket
      const carpeta = d.placa.toUpperCase().replace(/\s+/g, "");
      const rutasNuevas = await Promise.all(
        d.nuevasFotos.map((f) => subirImagen("vehiculos", carpeta, f)),
      );

      const registro = {
        placa: d.placa.toUpperCase().trim(),
        modelo: d.modelo.trim(),
        anio: d.anio,
        numero_chasis: d.numeroChasis.toUpperCase().trim(),
        precio_alquiler_diario: d.precioAlquilerDiario,
        precio_venta: d.precioVenta,
        kilometraje: d.kilometraje,
        fotos: [...d.fotosExistentes, ...rutasNuevas],
      };

      // 2. Insert o update
      const q = idExistente
        ? supabase.from("vehiculos").update(registro).eq("id", idExistente)
        : supabase.from("vehiculos").insert(registro);

      const { data, error } = await q.select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      for (const k of invalidaciones)
        void queryClient.invalidateQueries({ queryKey: [k] });
      if (idExistente)
        void queryClient.invalidateQueries({ queryKey: ["vehiculo", idExistente] });
    },
  });
}

// ── Cambiar estado (ej. enviar a mantenimiento) ──────────────
export function useCambiarEstadoVehiculo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (p: { id: string; estado: EstadoVehiculo }) => {
      const { error } = await supabase
        .from("vehiculos")
        .update({ estado: p.estado })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      for (const k of invalidaciones)
        void queryClient.invalidateQueries({ queryKey: [k] });
    },
  });
}
