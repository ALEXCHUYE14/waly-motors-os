"use client";

/**
 * WALY MOTORS OS — App Shell responsivo
 * ─────────────────────────────────────
 * Móvil   (<lg): Bottom Navigation persistente con botón flotante
 *                central "Cobrar" (Registro Express).
 * Desktop (≥lg): Sidebar colapsable con indicador en vivo de
 *                conexión Realtime a Supabase.
 *
 * Sistema visual "Taller Nocturno" (tokens en tailwind.config.ts):
 *   asfalto   #17181C  (superficie oscura: tarjetas, sidebar, inputs)
 *   noche     #101114  (fondo de página en modo oscuro)
 *   hueso     #F7F5F0  (superficie clara)
 *   amarillo  #FFC400  (amarillo mototaxi — acción primaria)
 *   oxido     #C4472B  (alertas / mora)
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Bike,
  Banknote,
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

// ── Cerrar sesión ─────────────────────────────────────────────
function useCerrarSesion() {
  const router = useRouter();

  return async () => {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };
}

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
          activo
            ? "text-amarillo"
            : "text-neutral-500 dark:text-neutral-400",
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={activo ? 2.5 : 2} />
        {label}
        {activo && (
          <motion.span
            layoutId="indicador-nav"
            className="absolute -top-1 h-1 w-6 rounded-full bg-amarillo"
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
        "border-t border-neutral-200 bg-white/95 backdrop-blur",
        "dark:border-neutral-800 dark:bg-asfalto/95",
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
              "bg-amarillo shadow-lg shadow-amarillo/30",
            )}
          >
            <Banknote className="h-6 w-6 -rotate-45 text-asfalto" strokeWidth={2.5} />
          </motion.span>
          <span className="mt-1 block text-center text-[11px] font-semibold text-neutral-700 dark:text-neutral-300">
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
        "border-r border-neutral-200 bg-white",
        "dark:border-neutral-800 dark:bg-asfalto",
      )}
    >
      {/* Marca */}
      <div className="flex items-center gap-3 px-4 py-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amarillo font-black text-asfalto">
          W
        </span>
        <AnimatePresence>
          {!colapsado && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="leading-tight"
            >
              <p className="font-black uppercase tracking-wide text-neutral-900 dark:text-white">
                Waly Motors
              </p>
              <p className="text-[11px] font-medium uppercase tracking-widest text-neutral-400">
                Sistema OS
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navegación */}
      <nav aria-label="Navegación principal" className="flex-1 space-y-1 px-3">
        {[...NAV_ITEMS, ACCION_RAPIDA].map(({ href, label, icon: Icon }) => {
          const activo = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={activo ? "page" : undefined}
              title={colapsado ? label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                "transition-colors focus-visible:outline-2 focus-visible:outline-amarillo",
                activo
                  ? "bg-amarillo/15 text-neutral-900 dark:text-amarillo"
                  : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800/60",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={activo ? 2.5 : 2} />
              {!colapsado && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Estado del sistema + colapso */}
      <div className="space-y-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium",
            conectado
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-oxido/10 text-oxido",
          )}
        >
          {conectado ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          {!colapsado && (conectado ? "Supabase en vivo" : "Sin conexión — modo offline")}
        </div>

        <button
          type="button"
          onClick={cerrarSesion}
          title={colapsado ? "Cerrar sesión" : undefined}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800/60"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!colapsado && "Cerrar sesión"}
        </button>

        <button
          type="button"
          onClick={() => setColapsado((v) => !v)}
          aria-label={colapsado ? "Expandir menú" : "Colapsar menú"}
          className="flex w-full items-center justify-center rounded-lg py-2 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
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
        "sticky top-0 z-40 flex items-center justify-between px-4 py-3 lg:hidden",
        "border-b border-neutral-200 bg-white/95 backdrop-blur",
        "dark:border-neutral-800 dark:bg-asfalto/95",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-amarillo text-xs font-black text-asfalto">
          W
        </span>
        <span className="text-sm font-black uppercase tracking-wide text-neutral-900 dark:text-white">
          Waly Motors
        </span>
      </div>
      <button
        type="button"
        onClick={cerrarSesion}
        aria-label="Cerrar sesión"
        className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
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

  // El login no lleva sidebar / bottom nav / barra superior.
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex min-h-dvh bg-hueso text-neutral-900 dark:bg-noche dark:text-neutral-100">
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
