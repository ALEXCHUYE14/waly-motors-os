"use client";

/**
 * WALY MOTORS OS — Hooks de Inventario de repuestos
 * El stock nunca se edita directamente: solo cambia a través de
 * `registrar_movimiento_repuesto` (entrada/salida), que bloquea la
 * fila del repuesto para que dos movimientos concurrentes no dejen
 * el conteo inconsistente. Ver migración 00007.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ── Tipos ────────────────────────────────────────────────────
export interface Repuesto {
  id: string;
  nombre: string;
  codigo: string | null;
  categoria: string | null;
  stock: number;
  stock_minimo: number;
  costo_unitario: number | null;
  unidad: string;
}

export interface DatosRepuesto {
  nombre: string;
  codigo: string;
  categoria: string;
  stockMinimo: number;
  costoUnitario: number | null;
  unidad: string;
}

export type TipoMovimiento = "entrada" | "salida";

export interface MovimientoRepuesto {
  id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  motivo: string | null;
  created_at: string;
  perfiles: { nombre: string } | null;
}

// ── Listado con búsqueda ──────────────────────────────────────
export function useRepuestos(termino: string) {
  const [debounced, setDebounced] = useState(termino);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(termino), 300);
    return () => clearTimeout(t);
  }, [termino]);

  return useQuery({
    queryKey: ["repuestos", debounced],
    staleTime: 30_000,
    queryFn: async (): Promise<Repuesto[]> => {
      let q = supabase.from("repuestos").select("*").order("nombre").limit(100);
      const t = debounced.trim();
      if (t.length >= 2) q = q.or(`nombre.ilike.%${t}%,codigo.ilike.%${t}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRepuesto(id: string) {
  return useQuery({
    queryKey: ["repuesto", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<Repuesto> => {
      const { data, error } = await supabase.from("repuestos").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });
}

export function useMovimientosRepuesto(repuestoId: string) {
  return useQuery({
    queryKey: ["movimientos-repuesto", repuestoId],
    enabled: Boolean(repuestoId),
    queryFn: async (): Promise<MovimientoRepuesto[]> => {
      const { data, error } = await supabase
        .from("movimientos_repuestos")
        .select("id, tipo, cantidad, motivo, created_at, perfiles:realizado_por (nombre)")
        .eq("repuesto_id", repuestoId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as unknown as MovimientoRepuesto[];
    },
  });
}

// ── Alta / edición del repuesto (datos maestros, no el stock) ──
export function useGuardarRepuesto(idExistente?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (d: DatosRepuesto) => {
      const registro = {
        nombre: d.nombre.trim(),
        codigo: d.codigo.trim() || null,
        categoria: d.categoria.trim() || null,
        stock_minimo: d.stockMinimo,
        costo_unitario: d.costoUnitario,
        unidad: d.unidad.trim() || "unidad",
      };

      const q = idExistente
        ? supabase.from("repuestos").update(registro).eq("id", idExistente)
        : supabase.from("repuestos").insert(registro);

      const { data, error } = await q.select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["repuestos"] });
      if (idExistente) void queryClient.invalidateQueries({ queryKey: ["repuesto", idExistente] });
    },
  });
}

// ── Movimiento de stock (entrada / salida) ────────────────────
export function useRegistrarMovimiento(repuestoId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (p: { tipo: TipoMovimiento; cantidad: number; motivo: string }) => {
      const { error } = await supabase.rpc("registrar_movimiento_repuesto", {
        p_repuesto_id: repuestoId,
        p_tipo: p.tipo,
        p_cantidad: p.cantidad,
        p_motivo: p.motivo || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["repuestos"] });
      void queryClient.invalidateQueries({ queryKey: ["repuesto", repuestoId] });
      void queryClient.invalidateQueries({ queryKey: ["movimientos-repuesto", repuestoId] });
    },
  });
}
