"use client";

/**
 * WALY MOTORS OS — Dashboard Diario
 * ─────────────────────────────────
 * KPIs (RPC kpis_dashboard) + sección "Acción Urgente" con
 * clientes en mora (RPC obtener_clientes_en_mora) y botón de
 * notificación por WhatsApp con mensaje pre-redactado dinámico.
 */

import { useState } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, TriangleAlert, Wallet, Bike, X } from "lucide-react";
import {
  supabase,
  soles,
  fechaCorta,
  type ClienteEnMora,
  type KpisDashboard,
} from "@/lib/supabase";
import { cn } from "@/lib/utils";

// ── Data hooks ───────────────────────────────────────────────
function useKpis() {
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

function useClientesEnMora() {
  return useQuery({
    queryKey: ["clientes-en-mora"],
    queryFn: async (): Promise<ClienteEnMora[]> => {
      const { data, error } = await supabase.rpc("obtener_clientes_en_mora");
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });
}

// ── Mensaje dinámico de cobranza ─────────────────────────────
function construirMensajeWhatsApp(c: ClienteEnMora): string {
  const primerNombre = c.nombre_completo.split(" ")[0];
  const fecha = fechaCorta.format(new Date(`${c.fecha_vencida}T12:00:00`));
  return (
    `Hola ${primerNombre}, te saludamos de Waly Motors. ` +
    `Te recordamos que tu cuota de ${soles.format(c.monto_cuota)} ` +
    `del vehículo de placa ${c.placa} venció el ${fecha}. ` +
    `Puedes realizar tu pago vía Yape, Plin o en efectivo con nuestro recaudador. ` +
    `¡Gracias por tu preferencia! 🛺`
  );
}

function abrirWhatsApp(telefono: string, mensaje: string): void {
  const numero = telefono.replace(/\D/g, ""); // "+51987..." → "51987..."
  window.open(
    `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`,
    "_blank",
    "noopener,noreferrer",
  );
}

// ── KPI Card ─────────────────────────────────────────────────
interface KpiCardProps {
  titulo: string;
  valor: string;
  icono: React.ReactNode;
  alerta?: boolean;
  cargando?: boolean;
}

function KpiCard({ titulo, valor, icono, alerta, cargando }: KpiCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        alerta
          ? "border-oxido/30 bg-oxido/5"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-asfalto",
      )}
    >
      <div className="flex items-center justify-between text-neutral-400">
        <span className="text-[11px] font-semibold uppercase tracking-widest">
          {titulo}
        </span>
        {icono}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-black tabular-nums",
          alerta ? "text-oxido" : "text-neutral-900 dark:text-white",
        )}
      >
        {cargando ? "···" : valor}
      </p>
    </div>
  );
}

// ── Modal de notificación WhatsApp ───────────────────────────
function ModalWhatsApp({
  cliente,
  onCerrar,
}: {
  cliente: ClienteEnMora;
  onCerrar: () => void;
}) {
  const [mensaje, setMensaje] = useState(() => construirMensajeWhatsApp(cliente));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] grid place-items-end bg-black/50 backdrop-blur-sm sm:place-items-center"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label={`Notificar a ${cliente.nombre_completo}`}
    >
      <motion.div
        initial={{ y: 48 }}
        animate={{ y: 0 }}
        exit={{ y: 48 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-asfalto sm:rounded-3xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-black uppercase tracking-wide">
              Notificar por WhatsApp
            </h2>
            <p className="text-sm text-neutral-500">
              {cliente.nombre_completo} · Placa {cliente.placa}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <textarea
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          rows={5}
          className={cn(
            "mt-4 w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm",
            "dark:border-neutral-700 dark:bg-neutral-900",
            "focus-visible:outline-2 focus-visible:outline-amarillo",
          )}
          aria-label="Mensaje a enviar"
        />

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            className="flex-1 rounded-xl border border-neutral-200 py-3 text-sm font-semibold dark:border-neutral-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!cliente.telefono}
            onClick={() => {
              if (cliente.telefono) abrirWhatsApp(cliente.telefono, mensaje);
              onCerrar();
            }}
            className={cn(
              "flex flex-[2] items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold",
              // Verde oficial de marca WhatsApp (token `whatsapp`): excepción
              // deliberada a la paleta interna — el botón de contacto debe
              // reconocerse como WhatsApp de un vistazo.
              "bg-whatsapp text-white active:scale-[0.98]",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            <MessageCircle className="h-4 w-4" />
            {cliente.telefono ? "Abrir WhatsApp" : "Sin teléfono registrado"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Tarjeta de cliente en mora ───────────────────────────────
function TarjetaMora({
  cliente,
  onNotificar,
}: {
  cliente: ClienteEnMora;
  onNotificar: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-asfalto">
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-800">
        {cliente.foto_perfil ? (
          <Image
            src={cliente.foto_perfil}
            alt={cliente.nombre_completo}
            fill
            className="object-cover"
            sizes="48px"
          />
        ) : (
          <span className="grid h-full w-full place-items-center font-black text-neutral-400">
            {cliente.nombre_completo.charAt(0)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{cliente.nombre_completo}</p>
        <p className="text-xs text-neutral-500">
          Placa <span className="font-mono font-bold">{cliente.placa}</span> ·{" "}
          {soles.format(cliente.monto_cuota)}
        </p>
        <p className="text-xs font-bold text-oxido">
          {cliente.dias_retraso} {cliente.dias_retraso === 1 ? "día" : "días"} de retraso
        </p>
      </div>

      <button
        type="button"
        onClick={onNotificar}
        aria-label={`Notificar a ${cliente.nombre_completo} por WhatsApp`}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-whatsapp/15 text-whatsapp active:scale-95"
      >
        <MessageCircle className="h-5 w-5" strokeWidth={2.5} />
      </button>
    </li>
  );
}

// ═════════════════════════════════════════════════════════════
// DASHBOARD
// ═════════════════════════════════════════════════════════════
export default function Dashboard() {
  const kpis = useKpis();
  const mora = useClientesEnMora();
  const [clienteActivo, setClienteActivo] = useState<ClienteEnMora | null>(null);

  const hoy = new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">
          {hoy}
        </p>
        <h1 className="text-2xl font-black uppercase tracking-tight">
          Control diario
        </h1>
      </header>

      {/* KPIs */}
      <section aria-label="Indicadores del día" className="grid grid-cols-3 gap-3">
        <KpiCard
          titulo="Caja hoy"
          valor={soles.format(kpis.data?.balance_hoy ?? 0)}
          icono={<Wallet className="h-4 w-4" />}
          cargando={kpis.isLoading}
        />
        <KpiCard
          titulo="Flota activa"
          valor={`${kpis.data?.pct_flota_activa ?? 0}%`}
          icono={<Bike className="h-4 w-4" />}
          cargando={kpis.isLoading}
        />
        <KpiCard
          titulo="En mora"
          valor={String(kpis.data?.clientes_en_mora ?? 0)}
          icono={<TriangleAlert className="h-4 w-4" />}
          alerta={(kpis.data?.clientes_en_mora ?? 0) > 0}
          cargando={kpis.isLoading}
        />
      </section>

      {/* Acción Urgente */}
      <section aria-label="Acción urgente">
        <div className="mb-3 flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 text-oxido" />
          <h2 className="text-sm font-black uppercase tracking-widest text-oxido">
            Acción urgente
          </h2>
        </div>

        {mora.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-[74px] animate-pulse rounded-2xl bg-neutral-200/60 dark:bg-neutral-800/60"
              />
            ))}
          </div>
        ) : mora.isError ? (
          <p className="rounded-2xl border border-oxido/30 bg-oxido/5 p-4 text-sm text-oxido">
            No se pudo cargar la lista de mora. Revisa tu conexión e intenta de nuevo.
          </p>
        ) : mora.data && mora.data.length > 0 ? (
          <ul className="space-y-3">
            {mora.data.map((c) => (
              <TarjetaMora
                key={c.contrato_id}
                cliente={c}
                onNotificar={() => setClienteActivo(c)}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Todo al día. Ningún cliente tiene cuotas vencidas hoy. 🛺
          </p>
        )}
      </section>

      <AnimatePresence>
        {clienteActivo && (
          <ModalWhatsApp
            cliente={clienteActivo}
            onCerrar={() => setClienteActivo(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
