"use client";

/**
 * WALY MOTORS OS — App Shell responsivo
 * ─────────────────────────────────────
 * Móvil   (<lg): Bottom Navigation persistente con botón flotante
 *                central "Cobrar" (Registro Express).
 * Desktop (≥lg): Sidebar colapsable con indicador en vivo de
 *                conexión Realtime a Supabase.
 *
 * Sistema visual "Blanco Taller + Cobre" (tokens en tailwind.config.ts):
 *   fondo     #F9F9F7  (fondo de página)
 *   tarjeta   #FFFFFF  (superficie: tarjetas, sidebar, inputs)
 *   borde     #EAE7E1  (bordes sutiles)
 *   grafito   #201F1D  (texto principal)
 *   cobre     #C97B3D  (acento de marca — nav activo, iconografía)
 *   amarillo  #FFC400  (reservado al CTA "Cobrar")
 *   oxido     #C4472B  (alertas / mora)
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Bike,
  FileSignature,
  Banknote,
  Package,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Wifi,
  WifiOff,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { AlertaCobrosFallidos } from "@/components/layout/alerta-cobros-fallidos";

// ── Rutas de navegación ──────────────────────────────────────
const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/vehiculos", label: "Vehículos", icon: Bike },
  { href: "/contratos", label: "Contratos", icon: FileSignature },
] as const;

const ACCION_RAPIDA = { href: "/pagos/nuevo", label: "Cobrar", icon: Banknote };

// ── Hook: estado de conexión Realtime ────────────────────────
// Solo se suscribe en desktop (el Sidebar donde se muestra está oculto
// en móvil): evita abrir un WebSocket innecesario en el celular del
// cobrador en calle, que es el uso real del sistema fuera de oficina.
function useConexionSupabase(): boolean {
  const [conectado, setConectado] = useState(true);

  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;

    const canal = supabase
      .channel("estado-conexion")
      .subscribe((status) => setConectado(status === "SUBSCRIBED"));

    const onOnline = () => setConectado(true);
    const onOffline = () => setConectado(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      supabase.removeChannel(canal);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return conectado;
}

// ── Hook: sincronización de datos en tiempo real ─────────────
// A diferencia del indicador de conexión (solo desktop), esto corre
// en todos los dispositivos: es lo que hace que, si un cobrador en
// calle registra un pago o cambia el estado de una mototaxi, el
// resto de pantallas abiertas (otro celular, la oficina) se
// actualicen solas sin recargar. Requiere que las tablas estén
// agregadas a la publicación `supabase_realtime` (migración 00008).
function useSincronizacionRealtime(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidar = (keys: string[]) => {
      for (const k of keys) void queryClient.invalidateQueries({ queryKey: [k] });
    };

    const canal = supabase
      .channel("sincronizacion-datos")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehiculos" }, () =>
        invalidar(["vehiculos", "vehiculos-disponibles", "vehiculos-alerta-mantenimiento", "kpis-dashboard"]),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "contratos" }, () =>
        invalidar(["contratos", "vehiculos-disponibles", "kpis-dashboard"]),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "pagos" }, () =>
        invalidar(["kpis-dashboard", "clientes-en-mora", "pagos-contrato", "resumen-contrato"]),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "mantenimientos" }, () =>
        invalidar(["mantenimientos", "vehiculos-alerta-mantenimiento", "kpis-dashboard", "vehiculos"]),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "repuestos" }, () =>
        invalidar(["repuestos", "repuesto"]),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "movimientos_repuestos" }, () =>
        invalidar(["repuestos", "repuesto", "movimientos-repuesto"]),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [queryClient]);
}

// ── Cerrar sesión ─────────────────────────────────────────────
function useCerrarSesion() {
  const router = useRouter();

  return async () => {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };
}

// Módulo secundario: solo visible en el Sidebar de escritorio. En móvil
// se llega desde el Dashboard o desde la pestaña "Mantenimiento" de un
// vehículo — el bottom nav de una mano ya está al límite con 4 tabs + FAB.
const REPUESTOS = { href: "/repuestos", label: "Repuestos", icon: Package };

// ═════════════════════════════════════════════════════════════
// BOTTOM NAV — Móvil
// ═════════════════════════════════════════════════════════════
function BottomNav({ pathname }: { pathname: string }) {
  const izquierda = NAV_ITEMS.slice(0, 2);
  const derecha = NAV_ITEMS.slice(2);

  const Item = ({ href, label, icon: Icon }: (typeof NAV_ITEMS)[number]) => {
    const activo = pathname.startsWith(href);
    return (
      <Link
        href={href}
        aria-current={activo ? "page" : undefined}
        className={cn(
          "relative flex flex-col items-center gap-0.5 px-3 py-1.5 text-[11px] font-medium",
          "transition-colors focus-visible:outline-2 focus-visible:outline-amarillo",
          activo ? "text-cobre" : "text-grafito/45",
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={activo ? 2.5 : 2} />
        {label}
        {activo && (
          <motion.span
            layoutId="indicador-nav"
            className="absolute -top-1 h-1 w-6 rounded-full bg-cobre"
          />
        )}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Navegación principal"
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 lg:hidden",
        "border-t border-borde bg-tarjeta/90 backdrop-blur-xl",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <div className="mx-auto flex max-w-md items-center justify-between px-4">
        {izquierda.map((item) => (
          <Item key={item.href} {...item} />
        ))}

        {/* Botón flotante central: Registro Express */}
        <Link
          href={ACCION_RAPIDA.href}
          aria-label="Registrar pago"
          className="relative -mt-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amarillo"
        >
          <motion.span
            whileTap={{ scale: 0.9 }}
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-2xl rotate-45",
              "bg-amarillo shadow-lg shadow-amarillo/40",
            )}
          >
            <Banknote className="h-6 w-6 -rotate-45 text-grafito" strokeWidth={2.5} />
          </motion.span>
          <span className="mt-1 block text-center text-[11px] font-semibold text-grafito/70">
            {ACCION_RAPIDA.label}
          </span>
        </Link>

        {derecha.map((item) => (
          <Item key={item.href} {...item} />
        ))}
      </div>
    </nav>
  );
}

// ═════════════════════════════════════════════════════════════
// SIDEBAR — Escritorio
// ═════════════════════════════════════════════════════════════
function Sidebar({ pathname }: { pathname: string }) {
  const [colapsado, setColapsado] = useState(false);
  const conectado = useConexionSupabase();
  const cerrarSesion = useCerrarSesion();

  return (
    <motion.aside
      animate={{ width: colapsado ? 76 : 248 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col lg:flex",
        "border-r border-borde bg-tarjeta",
      )}
    >
      {/* Marca — logo circular */}
      <div className="flex items-center justify-center px-4 py-5">
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-borde bg-tarjeta">
          <Image
            src="/img/logo.png"
            alt="Waly Motors"
            fill
            className="object-cover"
            sizes="44px"
            priority
          />
        </span>
      </div>

      {/* Navegación */}
      <nav aria-label="Navegación principal" className="flex-1 space-y-1 px-3">
        {[...NAV_ITEMS, REPUESTOS, ACCION_RAPIDA].map(({ href, label, icon: Icon }) => {
          const activo = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={activo ? "page" : undefined}
              title={colapsado ? label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                "transition-colors focus-visible:outline-2 focus-visible:outline-amarillo",
                activo
                  ? "bg-cobre/10 text-cobre"
                  : "text-grafito/55 hover:bg-fondo hover:text-grafito",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={activo ? 2.5 : 2} />
              {!colapsado && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Estado del sistema + colapso */}
      <div className="space-y-2 border-t border-borde p-3">
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium",
            conectado ? "bg-emerald-500/10 text-emerald-600" : "bg-oxido/10 text-oxido",
          )}
        >
          {conectado ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          {!colapsado && (conectado ? "Supabase en vivo" : "Sin conexión — modo offline")}
        </div>

        <button
          type="button"
          onClick={cerrarSesion}
          title={colapsado ? "Cerrar sesión" : undefined}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-grafito/55 hover:bg-fondo hover:text-grafito"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!colapsado && "Cerrar sesión"}
        </button>

        <button
          type="button"
          onClick={() => setColapsado((v) => !v)}
          aria-label={colapsado ? "Expandir menú" : "Colapsar menú"}
          className="flex w-full items-center justify-center rounded-lg py-2 text-grafito/40 hover:bg-fondo hover:text-grafito"
        >
          {colapsado ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>
    </motion.aside>
  );
}

// ═════════════════════════════════════════════════════════════
// TOP BAR — Móvil (solo marca + cerrar sesión)
// ═════════════════════════════════════════════════════════════
function MobileTopBar() {
  const cerrarSesion = useCerrarSesion();

  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex items-center justify-between px-4 pb-3 lg:hidden",
        // La barra vive dentro del área segura del notch/status bar del
        // teléfono (sobre todo en PWA instalada, `display: standalone`):
        // sin este padding el botón de cerrar sesión queda tapado por el
        // reloj/batería del sistema y no se puede presionar.
        "pt-[calc(env(safe-area-inset-top)+0.75rem)]",
        "border-b border-borde bg-tarjeta/90 backdrop-blur-xl",
      )}
    >
      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-borde bg-tarjeta">
        <Image src="/img/logo.png" alt="Waly Motors" fill className="object-cover" sizes="32px" />
      </span>
      <button
        type="button"
        onClick={cerrarSesion}
        aria-label="Cerrar sesión"
        className="rounded-lg p-2 text-grafito/40 hover:bg-fondo"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </header>
  );
}

// ═════════════════════════════════════════════════════════════
// SHELL
// ═════════════════════════════════════════════════════════════
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Se suscribe siempre (AppShell no se desmonta entre navegaciones, ni
  // siquiera hacia /login): así el hook nunca se llama condicionalmente.
  useSincronizacionRealtime();

  // El login no lleva sidebar / bottom nav / barra superior.
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex min-h-dvh bg-fondo text-grafito">
      <Sidebar pathname={pathname} />
      <div className="flex w-full flex-1 flex-col">
        <MobileTopBar />
        <AlertaCobrosFallidos />
        <main className="w-full flex-1 pb-24 lg:pb-0">{children}</main>
      </div>
      <BottomNav pathname={pathname} />
    </div>
  );
}
