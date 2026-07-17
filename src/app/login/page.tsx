"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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

  return (
    <div className="flex min-h-dvh items-center justify-center bg-fondo px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-3xl border border-borde bg-tarjeta p-7 shadow-card"
      >
        <div className="space-y-1 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-cobre font-black text-white">
            W
          </span>
          <h1 className="pt-2 font-black uppercase tracking-wide text-grafito">
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
      </form>
    </div>
  );
}
