"use client";

/**
 * WALY MOTORS OS — Hooks de contratos
 * TanStack Query sobre las RPCs de las migraciones 00003/00009.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, type FrecuenciaPago, type EstadoVehiculo } from "@/lib/supabase";
import { urlFirmadas, urlFirmada, subirArchivo, terminoBusquedaSeguro, archivoLocalAAdjunto } from "@/lib/utils";
import { generarContratoPdf } from "@/lib/contrato-pdf";

/** El enlace de descarga dura más que una sesión: el cobrador puede
 *  querer reabrirlo minutos después de crear el contrato. */
const SEGUNDOS_ENLACE_CONTRATO_NUEVO = 60 * 60 * 24 * 7;

// ── Tipos ────────────────────────────────────────────────────
export type EstadoContrato = "activo" | "vencido" | "finalizado";

export interface ContratoResumen {
  id: string;
  tipo: "alquiler" | "venta_credito";
  monto_total: number;
  monto_cuota: number;
  frecuencia_pago: FrecuenciaPago;
  estado: EstadoContrato;
  fecha_inicio: string;
  clientes: { nombre_completo: string; numero_documento: string } | null;
  vehiculos: { placa: string; modelo: string } | null;
}

export interface VehiculoDisponible {
  id: string;
  placa: string;
  modelo: string;
  anio: number;
  numero_chasis: string;
  estado: EstadoVehiculo;
  precio_alquiler_diario: number | null;
  precio_venta: number | null;
  kilometraje: number;
  fotos: string[];
}

export interface ClienteBasico {
  id: string;
  tipo_documento: "DNI" | "RUC";
  nombre_completo: string;
  numero_documento: string;
  telefono: string | null;
  direccion: string | null;
  foto_perfil: string | null;
}

export interface NuevoContrato {
  cliente: ClienteBasico;
  vehiculo: VehiculoDisponible;
  tipo: "alquiler" | "venta_credito";
  montoTotal: number;
  cuotaInicial: number;
  montoCuota: number;
  frecuencia: FrecuenciaPago;
  diaPagoPreferido?: number;
  fechaInicio: string; // ISO date
  fechaFin?: string;
  firmaBase64: string;
  documentosGarantia: File[];
}

export interface ResultadoCrearContrato {
  id: string;
  created_at: string;
  /** Enlace firmado del PDF recién generado — `null` si la generación o la
   *  subida fallaron (el contrato ya quedó creado igual; el detalle del
   *  contrato lo regenera on-demand). */
  contratoPdfUrl: string | null;
}

// ── Listado de contratos (módulo Contratos) ──────────────────
export function useContratos(filtroEstado?: EstadoContrato | "todos") {
  return useQuery({
    queryKey: ["contratos", filtroEstado ?? "todos"],
    staleTime: 30_000,
    queryFn: async (): Promise<ContratoResumen[]> => {
      let q = supabase
        .from("contratos")
        .select(
          "id, tipo, monto_total, monto_cuota, frecuencia_pago, estado, fecha_inicio, clientes(nombre_completo, numero_documento), vehiculos(placa, modelo)",
        )
        .order("created_at", { ascending: false });
      if (filtroEstado && filtroEstado !== "todos") q = q.eq("estado", filtroEstado);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ContratoResumen[];
    },
  });
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
      const q = terminoBusquedaSeguro(debounced);
      const { data, error } = await supabase
        .from("clientes")
        .select("id, tipo_documento, nombre_completo, numero_documento, telefono, direccion, foto_perfil")
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

// ── Crear contrato (RPC atómica + firma + garantías + PDF) ───
export function useCrearContrato() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (c: NuevoContrato) => {
      // 1. RPC atómica primero: bloquea el vehículo, valida disponibilidad
      // y crea el contrato (con la firma, que es solo texto). Los
      // documentos de garantía se suben DESPUÉS —si el vehículo ya no
      // está disponible y el RPC falla, no quedan archivos huérfanos en
      // el bucket de un contrato que nunca llegó a existir.
      const { data, error } = await supabase.rpc("crear_contrato", {
        p_cliente_id: c.cliente.id,
        p_vehiculo_id: c.vehiculo.id,
        p_tipo: c.tipo,
        p_monto_total: c.montoTotal,
        p_cuota_inicial: c.cuotaInicial,
        p_monto_cuota: c.montoCuota,
        p_frecuencia_pago: c.frecuencia,
        p_dia_pago_preferido: c.diaPagoPreferido ?? null,
        p_fecha_inicio: c.fechaInicio,
        p_fecha_fin: c.fechaFin ?? null,
        p_firma_base64: c.firmaBase64,
      });
      if (error) throw error;

      const contrato = data as { id: string; created_at: string };

      // 2. Documentos de garantía: ahora sí, con el contrato ya creado
      // como carpeta real. Si la subida falla, el contrato queda creado
      // igual — no se bloquea lo financiero por un artefacto secundario.
      let rutasGarantia: string[] = [];
      try {
        rutasGarantia = await Promise.all(
          c.documentosGarantia.map((f) => subirArchivo("garantias", contrato.id, f)),
        );
        if (rutasGarantia.length > 0) {
          await supabase
            .from("contratos")
            .update({ documentos_garantia: rutasGarantia })
            .eq("id", contrato.id);
        }
      } catch {
        // Ver comentario arriba: no propagar el error de las garantías.
      }

      // 3. Generar el PDF del contrato y subirlo al bucket `contratos`. Si
      // esto falla, el contrato igual quedó creado correctamente —
      // DetalleContrato lo regenera on-demand la primera vez que se pida
      // descargar/enviar (nunca se bloquea lo financiero por un artefacto
      // secundario, mismo criterio que la cola de cobros offline).
      //
      // Nota: la descarga NO se dispara aquí con `pdf.save()` (blob +
      // <a download> simulado). En WebViews/PWA instaladas (`display:
      // standalone`, el modo real de uso en calle) ese truco puede navegar
      // a la URL blob en vez de descargar, dejando la pantalla en blanco y
      // pareciendo "congelada" sin forma de volver. En su lugar devolvemos
      // un enlace firmado y es la pantalla de éxito la que abre la
      // descarga con un clic real del usuario — el mismo patrón, ya
      // probado, que usa el botón "Descargar" en el detalle del contrato.
      let contratoPdfUrl: string | null = null;
      try {
        const numCuotas = Math.ceil((c.montoTotal - c.cuotaInicial) / c.montoCuota);
        // Los archivos ya están en memoria (recién elegidos) — se leen
        // directo a data URL para incrustarlos, sin volver a bajarlos de
        // Supabase (que además todavía podrían no estar subidos si el
        // paso 2 de arriba falló).
        const adjuntos = await Promise.all(c.documentosGarantia.map(archivoLocalAAdjunto));
        const pdf = await generarContratoPdf({
          contratoId: contrato.id,
          tipo: c.tipo,
          creadoEnIso: contrato.created_at,
          clienteNombre: c.cliente.nombre_completo,
          clienteTipoDocumento: c.cliente.tipo_documento,
          clienteDocumento: c.cliente.numero_documento,
          clienteDireccion: c.cliente.direccion,
          clienteTelefono: c.cliente.telefono,
          vehiculoPlaca: c.vehiculo.placa,
          vehiculoModelo: c.vehiculo.modelo,
          vehiculoAnio: c.vehiculo.anio,
          vehiculoChasis: c.vehiculo.numero_chasis,
          vehiculoKm: c.vehiculo.kilometraje,
          montoTotal: c.montoTotal,
          cuotaInicial: c.cuotaInicial,
          montoCuota: c.montoCuota,
          frecuenciaPago: c.frecuencia,
          numCuotasEstimadas: numCuotas,
          fechaInicioIso: c.fechaInicio,
          fechaFinIso: c.fechaFin ?? null,
          firmaBase64: c.firmaBase64,
          firmaFechaIso: contrato.created_at,
          documentosGarantia: adjuntos,
        });

        const rutaPdf = `${contrato.id}/contrato.pdf`;
        const archivoPdf = new File([pdf.output("blob")], "contrato.pdf", { type: "application/pdf" });
        const { error: errSubida } = await supabase.storage
          .from("contratos")
          .upload(rutaPdf, archivoPdf, { contentType: "application/pdf" });
        if (!errSubida) {
          await supabase.from("contratos").update({ contrato_pdf_url: rutaPdf }).eq("id", contrato.id);
          contratoPdfUrl = await urlFirmada("contratos", rutaPdf, SEGUNDOS_ENLACE_CONTRATO_NUEVO);
        }
      } catch {
        // Ver comentario arriba: no propagar el error del PDF ni el de su subida.
      }

      return { ...contrato, contratoPdfUrl } satisfies ResultadoCrearContrato;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehiculos-disponibles"] });
      void queryClient.invalidateQueries({ queryKey: ["vehiculos"] });
      void queryClient.invalidateQueries({ queryKey: ["kpis-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["clientes-en-mora"] });
      void queryClient.invalidateQueries({ queryKey: ["contratos"] });
    },
  });
}

// ── Finalizar contrato ───────────────────────────────────────
export type MotivoFinalizacion = "completado" | "incumplimiento";

export interface DatosFinalizarContrato {
  contratoId: string;
  /** 'completado' (default): alquiler libera la mototaxi, venta a
   *  crédito la deja vendida — igual que siempre. 'incumplimiento':
   *  el cliente no pagó y se recuperó el vehículo — se libera SIEMPRE,
   *  incluso si el contrato era de venta a crédito (si no, la mototaxi
   *  quedaba marcada "vendida" para siempre aunque nunca se terminó de
   *  pagar). Ver migración 00014. */
  motivo?: MotivoFinalizacion;
}

export function useFinalizarContrato() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ contratoId, motivo }: DatosFinalizarContrato) => {
      const { data, error } = await supabase.rpc("finalizar_contrato", {
        p_contrato_id: contratoId,
        p_motivo: motivo ?? "completado",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehiculos-disponibles"] });
      void queryClient.invalidateQueries({ queryKey: ["vehiculos"] });
      void queryClient.invalidateQueries({ queryKey: ["kpis-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["clientes-en-mora"] });
      void queryClient.invalidateQueries({ queryKey: ["contratos"] });
    },
  });
}
