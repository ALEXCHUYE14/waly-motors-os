"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { abrirWhatsApp } from "@/lib/utils";

// Número de soporte — se pasa a abrirWhatsApp, que ya limpia el formato.
const WHATSAPP_SOPORTE = "+51924996961";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

          <form
            onSubmit={handleSubmit}
            className="space-y-5 rounded-3xl border border-borde bg-tarjeta p-7 pt-14 shadow-card lg:pt-7"
          >
            <div className="space-y-1 text-center">
              <h1 className="font-black uppercase tracking-wide text-grafito">
                Waly Motors OS
              </h1>
              <p className="text-xs text-grafito/50">
                Ingresa con tu cuenta de empleado
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="email" className="mb-1 block text-xs font-medium text-grafito/60">
                  Correo
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-borde bg-fondo px-3 py-2.5 text-sm text-grafito outline-none focus:border-cobre"
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1 block text-xs font-medium text-grafito/60">
                  Contraseña
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-borde bg-fondo px-3 py-2.5 text-sm text-grafito outline-none focus:border-cobre"
                />
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
              className="w-full rounded-xl bg-amarillo py-3 text-sm font-bold text-grafito transition-opacity active:scale-[0.98] disabled:opacity-60"
            >
              {cargando ? "Ingresando..." : "Ingresar"}
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
          </form>

          <p className="mt-5 text-center text-[11px] text-grafito/30">
            © {new Date().getFullYear()} Waly Motors. Todos los derechos reservados.
          </p>
        </div>
      </div>

      {/* ── Columna de imagen — oculta en móvil, visible desde lg ──
          El recuadro interior respeta la proporción real del archivo
          (3:2) para que la imagen toque los 4 bordes del recorte: solo
          así el zoom recorta el marco negro del archivo por igual en
          todo el contorno (con `object-contain` en una caja más alta
          que ancha, arriba/abajo quedan lejos del borde de recorte y
          el marco nunca se llega a cortar ahí). */}
      <div className="relative hidden w-1/2 items-center justify-center bg-white lg:flex">
        <div className="relative aspect-[3/2] w-full max-w-lg overflow-hidden rounded-2xl">
          <Image
            src="/img/logo.png"
            alt=""
            fill
            sizes="50vw"
            className="scale-110 object-cover"
            priority
          />
        </div>
      </div>
    </div>
  );
}
