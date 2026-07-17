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
    <div className="flex min-h-dvh items-center justify-center bg-hueso px-4 dark:bg-noche">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-asfalto"
      >
        <div className="space-y-1 text-center">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-lg bg-amarillo font-black text-asfalto">
            W
          </span>
          <h1 className="pt-2 font-black uppercase tracking-wide text-neutral-900 dark:text-white">
            Waly Motors OS
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Ingresa con tu cuenta de empleado
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300"
            >
              Correo
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-amarillo dark:border-neutral-700"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300"
            >
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-amarillo dark:border-neutral-700"
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
          className="w-full rounded-lg bg-amarillo py-2.5 text-sm font-bold text-asfalto transition-opacity disabled:opacity-60"
        >
          {cargando ? "Ingresando..." : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
