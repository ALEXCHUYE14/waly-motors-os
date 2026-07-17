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
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageCircle,
  TriangleAlert,
  Wallet,
  Bike,
  Wrench,
  Package,
  ChevronRight,
  X,
} from "lucide-react";
import {
  supabase,
  soles,
  fechaCorta,
  type ClienteEnMora,
  type KpisDashboard,
} from "@/lib/supabase";
import { cn, urlFirmadas, abrirWhatsApp } from "@/lib/utils";

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

      const clientes = (data ?? []) as ClienteEnMora[];

      // Bucket `clientes` es privado — firmar antes de exponer al UI.
      const rutas = clientes.map((c) => c.foto_perfil).filter(Boolean) as string[];
      const urlPorRuta = await urlFirmadas("clientes", rutas);

      return clientes.map((c) => ({
        ...c,
        foto_perfil: c.foto_perfil ? urlPorRuta.get(c.foto_perfil) ?? null : null,
      }));
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
        alerta ? "border-oxido/25 bg-oxido/5" : "border-borde bg-tarjeta shadow-card",
      )}
    >
      <div className="flex items-center justify-between text-grafito/40">
        <span className="text-[11px] font-semibold uppercase tracking-widest">
          {titulo}
        </span>
        {icono}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-black tabular-nums",
          alerta ? "text-oxido" : "text-grafito",
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
      className="fixed inset-0 z-[60] grid place-items-end bg-grafito/40 backdrop-blur-sm sm:place-items-center"
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
        className="w-full max-w-md rounded-t-3xl bg-tarjeta p-5 shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-black uppercase tracking-wide text-grafito">
              Notificar por WhatsApp
            </h2>
            <p className="text-sm text-grafito/50">
              {cliente.nombre_completo} · Placa {cliente.placa}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-grafito/40 hover:bg-fondo"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <textarea
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          rows={5}
          className={cn(
            "mt-4 w-full resize-none rounded-xl border border-borde bg-fondo p-3 text-sm text-grafito",
            "focus-visible:outline-2 focus-visible:outline-amarillo",
          )}
          aria-label="Mensaje a enviar"
        />

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            className="flex-1 rounded-xl border border-borde py-3 text-sm font-semibold text-grafito"
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
    <li className="flex items-center gap-3 rounded-2xl border border-borde bg-tarjeta p-3 shadow-card">
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-fondo">
        {cliente.foto_perfil ? (
          <Image
            src={cliente.foto_perfil}
            alt={cliente.nombre_completo}
            fill
            className="object-cover"
            sizes="48px"
          />
        ) : (
          <span className="grid h-full w-full place-items-center font-black text-grafito/30">
            {cliente.nombre_completo.charAt(0)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-grafito">{cliente.nombre_completo}</p>
        <p className="text-xs text-grafito/50">
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

  const enMantenimiento = kpis.data?.vehiculos_en_alerta_mantenimiento ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-grafito/40">
          {hoy}
        </p>
        <h1 className="text-2xl font-black uppercase tracking-tight text-grafito">
          Control diario
        </h1>
      </header>

      {/* KPIs */}
      <section aria-label="Indicadores del día" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        <KpiCard
          titulo="Mantenim."
          valor={String(enMantenimiento)}
          icono={<Wrench className="h-4 w-4" />}
          alerta={enMantenimiento > 0}
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
              <div key={i} className="h-[74px] animate-pulse rounded-2xl bg-borde/60" />
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
          <p className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm font-medium text-emerald-600">
            Todo al día. Ningún cliente tiene cuotas vencidas hoy. 🛺
          </p>
        )}
      </section>

      {/* Accesos secundarios (no viven en el bottom nav móvil) */}
      <section aria-label="Otros módulos">
        <Link
          href="/repuestos"
          className="flex items-center gap-3 rounded-2xl border border-borde bg-tarjeta p-4 shadow-card active:scale-[0.99]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cobre/10 text-cobre">
            <Package className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-grafito">Inventario de repuestos</span>
            <span className="block text-xs text-grafito/50">Stock, entradas y salidas del taller</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-grafito/30" />
        </Link>
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
