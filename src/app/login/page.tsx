"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  MessageCircle,
  Users,
  Wallet,
  Bike,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { abrirWhatsApp } from "@/lib/utils";

// Número de soporte — se pasa a abrirWhatsApp, que ya limpia el formato.
const WHATSAPP_SOPORTE = "+51924996961";

// Puntos de valor del panel de escritorio — mismo vocabulario de iconos
// que ya usa el dashboard (Users/Wallet/Bike), para que se sienta parte
// del mismo sistema y no un adorno suelto.
const CARACTERISTICAS = [
  { icono: Users, texto: "Clientes y contratos digitales con firma" },
  { icono: Wallet, texto: "Cobros, mora y caja del día en vivo" },
  { icono: Bike, texto: "Flota, mantenimiento y repuestos" },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setCargando(false);
      setError("Correo o contraseña incorrectos");
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  function contactarSoporte() {
    abrirWhatsApp(
      WHATSAPP_SOPORTE,
      "Hola, necesito ayuda para ingresar a Waly Motors OS.",
    );
  }

  return (
    <div className="flex min-h-dvh bg-fondo">
      {/* ── Columna del formulario ── */}
      <div className="flex w-full flex-col items-center justify-center px-4 py-10 sm:px-6 lg:w-1/2 lg:px-12">
        <div className="w-full max-w-sm">
          {/* Logo: solo en móvil, en una tarjeta que se monta sobre el
              formulario (mismo efecto "portada + tarjeta superpuesta" que
              en escritorio el logo vive en el panel derecho — mostrarlo
              aquí también sería redundante).
              El recuadro respeta la proporción real del archivo (3:2):
              así la imagen toca los 4 bordes del recorte y el zoom
              recorta el marco negro del archivo por igual en todo el
              contorno, no solo en dos lados. */}
          <div className="relative z-10 mx-auto -mb-10 aspect-[3/2] w-40 overflow-hidden rounded-2xl border border-borde bg-white shadow-card lg:hidden">
            <Image
              src="/img/logo.png"
              alt="Waldir Motors S.A.C."
              fill
              sizes="160px"
              className="scale-110 object-cover"
              priority
            />
          </div>

          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="space-y-5 rounded-3xl border border-borde bg-tarjeta p-7 pt-14 shadow-card lg:pt-7"
          >
            <div className="space-y-1 text-center">
              <h1 className="font-black uppercase tracking-wide text-grafito">
                Waly Motors OS
              </h1>
              <p className="text-xs text-grafito/50">
                Ingresa con tu cuenta de Administrador
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="email" className="mb-1 block text-xs font-medium text-grafito/60">
                  Correo
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-grafito/30" />
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                    className="w-full rounded-xl border border-borde bg-fondo py-2.5 pl-9 pr-3 text-sm text-grafito outline-none transition-colors focus:border-cobre focus:ring-2 focus:ring-cobre/15"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="password" className="mb-1 block text-xs font-medium text-grafito/60">
                  Contraseña
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-grafito/30" />
                  <input
                    id="password"
                    type={mostrarPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-borde bg-fondo py-2.5 pl-9 pr-9 text-sm text-grafito outline-none transition-colors focus:border-cobre focus:ring-2 focus:ring-cobre/15"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarPassword((v) => !v)}
                    aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-grafito/30 hover:text-grafito/60"
                  >
                    {mostrarPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-oxido/10 px-3 py-2 text-xs font-medium text-oxido"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={cargando}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amarillo py-3 text-sm font-bold text-grafito transition-opacity active:scale-[0.98] disabled:opacity-60"
            >
              {cargando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Ingresando…
                </>
              ) : (
                "Ingresar"
              )}
            </button>

            <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-widest text-grafito/30">
              <span className="h-px flex-1 bg-borde" />
              o
              <span className="h-px flex-1 bg-borde" />
            </div>

            <button
              type="button"
              onClick={contactarSoporte}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-whatsapp/30 bg-whatsapp/5 py-3 text-sm font-bold text-whatsapp active:scale-[0.98]"
            >
              <MessageCircle className="h-4 w-4" /> Contactar con soporte
            </button>
          </motion.form>

          <p className="mt-5 text-center text-[11px] text-grafito/30">
            © {new Date().getFullYear()} Waly Motors. Todos los derechos reservados.
          </p>
        </div>
      </div>

      {/* ── Columna de imagen — oculta en móvil, visible desde lg ──
          Fondo blanco puro (pedido explícito, sin degradados ni color
          de marca de fondo) — el recuadro interior respeta la
          proporción real del archivo (3:2) para que la imagen toque
          los 4 bordes del recorte: solo así el zoom recorta el marco
          negro del archivo por igual en todo el contorno. El resto del
          panel suma una frase de valor y 3 puntos clave para que no
          quede solo el logo flotando en blanco. */}
      <div className="relative hidden w-1/2 flex-col items-center justify-center gap-10 bg-white px-12 lg:flex">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="flex flex-col items-center text-center"
        >
          <div className="relative aspect-[3/2] w-52 overflow-hidden rounded-2xl shadow-card">
            <Image
              src="/img/logo.png"
              alt=""
              fill
              sizes="208px"
              className="scale-110 object-cover"
              priority
            />
          </div>
          <p className="mt-6 max-w-sm text-sm text-grafito/50">
            Gestión integral de alquiler y venta de mototaxis: clientes, contratos, cobros y flota
            en un solo lugar.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut", delay: 0.1 }}
          className="grid w-full max-w-sm gap-3"
        >
          {CARACTERISTICAS.map(({ icono: Icono, texto }) => (
            <div
              key={texto}
              className="flex items-center gap-3 rounded-xl border border-borde bg-fondo px-4 py-3"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cobre/10 text-cobre">
                <Icono className="h-4 w-4" />
              </span>
              <span className="text-xs font-semibold text-grafito/70">{texto}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
