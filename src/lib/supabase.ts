import { createBrowserClient } from "@supabase/ssr";

// ── Tipos de dominio ─────────────────────────────────────────
export type Rol = "admin" | "mecanico" | "asesor";
export type EstadoVehiculo = "disponible" | "alquilado" | "en_mantenimiento" | "vendido";
export type MetodoPago = "efectivo" | "yape" | "plin" | "transferencia";
export type FrecuenciaPago = "diario" | "semanal" | "quincenal" | "mensual";

export interface ClienteEnMora {
  contrato_id: string;
  cliente_id: string;
  nombre_completo: string;
  telefono: string | null;
  foto_perfil: string | null;
  placa: string;
  monto_cuota: number;
  fecha_vencida: string; // ISO date
  dias_retraso: number;
}

export interface KpisDashboard {
  balance_hoy: number;
  pct_flota_activa: number;
  clientes_en_mora: number;
  vehiculos_en_alerta_mantenimiento: number;
}

// ── Cliente browser (singleton) ──────────────────────────────
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// ── Formateadores locale Perú ────────────────────────────────
export const soles = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
});

export const fechaCorta = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
});
