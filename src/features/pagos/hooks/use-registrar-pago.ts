"use client";

/**
 * WALY MOTORS OS — useRegistrarPago
 * ─────────────────────────────────
 * Mutación completa del cobro en calle:
 *   1. Sube la foto del comprobante al bucket privado `evidencias`.
 *   2. Llama a la RPC atómica `registrar_pago` (FOR UPDATE en contrato).
 *   3. Invalida KPIs y lista de mora.
 *
 * Offline-First: si no hay señal, el cobro se encola en localStorage
 * (foto en base64) y se reintenta automáticamente al recuperar
 * conexión o al montar la app.
 */

import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase, type MetodoPago } from "@/lib/supabase";
import { mensajeError } from "@/lib/utils";

// ── Tipos ────────────────────────────────────────────────────
export interface NuevoCobro {
  contratoId: string;
  monto: number;
  metodo: MetodoPago;
  evidencia: File | null;
  observaciones?: string;
}

interface CobroEncolado {
  id: string;
  contratoId: string;
  monto: number;
  metodo: MetodoPago;
  evidenciaBase64: string | null;
  evidenciaNombre: string | null;
  observaciones?: string;
  creadoEn: string;
}

const CLAVE_COLA = "waly:cola-cobros";
const CLAVE_FALLIDOS = "waly:cola-cobros-fallidos";
/** Se dispara cuando cambia la lista de fallidos, para que el banner
 *  global (montado en otra parte del árbol) se entere sin hacer polling. */
export const EVENTO_COBROS_FALLIDOS = "waly:cobros-fallidos-cambio";

export interface CobroFallido extends CobroEncolado {
  error: string;
  falloEn: string;
}

// ── Utilidades de cola offline ───────────────────────────────
function leerCola(): CobroEncolado[] {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_COLA) ?? "[]");
  } catch {
    return [];
  }
}

function guardarCola(cola: CobroEncolado[]): void {
  localStorage.setItem(CLAVE_COLA, JSON.stringify(cola));
}

/** Cobros que se reintentaron y fallaron por un error de negocio (no de red):
 *  nunca se descartan en silencio, quedan aquí para que un admin los revise. */
export function leerCobrosFallidos(): CobroFallido[] {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_FALLIDOS) ?? "[]");
  } catch {
    return [];
  }
}

function agregarCobroFallido(item: CobroEncolado, error: unknown): void {
  const fallidos = leerCobrosFallidos();
  fallidos.push({
    ...item,
    error: mensajeError(error, "Error desconocido al reintentar el cobro"),
    falloEn: new Date().toISOString(),
  });
  localStorage.setItem(CLAVE_FALLIDOS, JSON.stringify(fallidos));
  window.dispatchEvent(new Event(EVENTO_COBROS_FALLIDOS));
}

export function descartarCobroFallido(id: string): void {
  const fallidos = leerCobrosFallidos().filter((f) => f.id !== id);
  localStorage.setItem(CLAVE_FALLIDOS, JSON.stringify(fallidos));
  window.dispatchEvent(new Event(EVENTO_COBROS_FALLIDOS));
}

function archivoABase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("No se pudo leer la imagen"));
    r.readAsDataURL(file);
  });
}

function base64AArchivo(dataUrl: string, nombre: string): File {
  const [meta, datos] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);/)?.[1] ?? "image/jpeg";
  const bin = atob(datos);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], nombre, { type: mime });
}

// ── Ejecución real del cobro ─────────────────────────────────
async function ejecutarCobro(cobro: NuevoCobro): Promise<void> {
  let evidenciaUrl: string | null = null;

  if (cobro.evidencia) {
    const ruta = `${cobro.contratoId}/${Date.now()}-${cobro.evidencia.name}`;
    const { error: errSubida } = await supabase.storage
      .from("evidencias")
      .upload(ruta, cobro.evidencia, { contentType: cobro.evidencia.type });
    if (errSubida) throw errSubida;
    evidenciaUrl = ruta; // ruta interna; se firma URL al visualizar
  }

  const { error } = await supabase.rpc("registrar_pago", {
    p_contrato_id: cobro.contratoId,
    p_monto: cobro.monto,
    p_metodo: cobro.metodo,
    p_evidencia_url: evidenciaUrl,
    p_observaciones: cobro.observaciones ?? null,
  });
  if (error) throw error;
}

function esErrorDeRed(err: unknown): boolean {
  return (
    !navigator.onLine ||
    (err instanceof TypeError && /fetch|network/i.test(err.message))
  );
}

// Evita que dos instancias del hook (doble montaje, dos pestañas) reenvíen
// la misma cola en simultáneo y dupliquen un cobro.
let drenando = false;

// ── Hook principal ───────────────────────────────────────────
export function useRegistrarPago() {
  const queryClient = useQueryClient();

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: ["kpis-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["clientes-en-mora"] });
  };

  // Reintento automático de la cola al recuperar conexión
  useEffect(() => {
    async function drenarCola() {
      if (drenando) return;
      const cola = leerCola();
      if (cola.length === 0 || !navigator.onLine) return;

      drenando = true;
      try {
        const pendientes: CobroEncolado[] = [];
        for (const item of cola) {
          try {
            await ejecutarCobro({
              contratoId: item.contratoId,
              monto: item.monto,
              metodo: item.metodo,
              evidencia:
                item.evidenciaBase64 && item.evidenciaNombre
                  ? base64AArchivo(item.evidenciaBase64, item.evidenciaNombre)
                  : null,
              observaciones: item.observaciones,
            });
          } catch (err) {
            if (esErrorDeRed(err)) {
              pendientes.push(item); // reintentar luego
            } else {
              // Error de negocio (contrato inactivo, ya finalizado, etc.):
              // nunca se descarta en silencio — el dinero ya se cobró en calle.
              agregarCobroFallido(item, err);
            }
          }
        }
        guardarCola(pendientes);
        if (pendientes.length < cola.length) invalidar();
      } finally {
        drenando = false;
      }
    }

    void drenarCola();
    window.addEventListener("online", drenarCola);
    return () => window.removeEventListener("online", drenarCola);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mutation = useMutation({
    mutationFn: ejecutarCobro,
    onSuccess: invalidar,
    onError: async (err, cobro) => {
      // Sin señal → encolar para sincronización posterior
      if (esErrorDeRed(err)) {
        const cola = leerCola();
        cola.push({
          id: crypto.randomUUID(),
          contratoId: cobro.contratoId,
          monto: cobro.monto,
          metodo: cobro.metodo,
          evidenciaBase64: cobro.evidencia
            ? await archivoABase64(cobro.evidencia)
            : null,
          evidenciaNombre: cobro.evidencia?.name ?? null,
          observaciones: cobro.observaciones,
          creadoEn: new Date().toISOString(),
        });
        guardarCola(cola);
      }
    },
  });

  return {
    ...mutation,
    /** true si el último intento quedó encolado por falta de señal */
    encoladoOffline:
      mutation.isError && esErrorDeRed(mutation.error),
    pendientesEnCola: typeof window !== "undefined" ? leerCola().length : 0,
  };
}
