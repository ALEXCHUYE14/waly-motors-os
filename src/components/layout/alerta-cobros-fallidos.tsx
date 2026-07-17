"use client";

/**
 * WALY MOTORS OS — Alerta de cobros fallidos
 * ───────────────────────────────────────────
 * Cobros hechos en calle (offline) que al reintentarse fallaron por un
 * error de negocio (contrato ya finalizado, etc.) NUNCA se descartan en
 * silencio — quedan en localStorage y este banner, montado a nivel de
 * app, avisa sin importar en qué pantalla esté el usuario cuando ocurre.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import {
  descartarCobroFallido,
  leerCobrosFallidos,
  EVENTO_COBROS_FALLIDOS,
  type CobroFallido,
} from "@/features/pagos/hooks/use-registrar-pago";
import { soles } from "@/lib/supabase";

export function AlertaCobrosFallidos() {
  const [fallidos, setFallidos] = useState<CobroFallido[]>([]);

  useEffect(() => {
    const actualizar = () => setFallidos(leerCobrosFallidos());
    actualizar();

    window.addEventListener(EVENTO_COBROS_FALLIDOS, actualizar);
    window.addEventListener("storage", actualizar);
    return () => {
      window.removeEventListener(EVENTO_COBROS_FALLIDOS, actualizar);
      window.removeEventListener("storage", actualizar);
    };
  }, []);

  if (fallidos.length === 0) return null;

  return (
    <div
      role="alert"
      className="border-b border-oxido/30 bg-oxido/10 px-4 py-2.5 text-sm text-oxido"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <div className="flex items-start gap-2 font-semibold">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {fallidos.length === 1
              ? "1 cobro no se pudo registrar"
              : `${fallidos.length} cobros no se pudieron registrar`}{" "}
            — el dinero ya fue cobrado en calle, revísalo con el administrador.
          </span>
        </div>
        <ul className="space-y-1 pl-6 text-xs">
          {fallidos.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3">
              <span>
                {soles.format(f.monto)} · {f.error}
              </span>
              <button
                type="button"
                onClick={() => descartarCobroFallido(f.id)}
                className="shrink-0 rounded p-1 hover:bg-oxido/10"
                aria-label="Marcar como resuelto"
                title="Marcar como resuelto"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
