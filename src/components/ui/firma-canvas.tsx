"use client";

/**
 * WALY MOTORS OS — Firma digital (canvas táctil)
 * ───────────────────────────────────────────────
 * Captura de firma sin dependencias externas: dibuja con
 * puntero/dedo/mouse (Pointer Events unifica ambos), ajusta la
 * resolución con devicePixelRatio para trazo nítido y expone un
 * export a PNG base64 vía ref. `touch-none` evita que el gesto de
 * firmar haga scroll de la página en móvil.
 *
 * Nota de honestidad: esto es una firma electrónica simple
 * registrada en el sistema, no una firma digital certificada con
 * validez criptográfica — así se rotula en el PDF que la incrusta.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Eraser } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FirmaCanvasHandle {
  /** PNG en base64 (data URL) de la firma, o null si el usuario no ha trazado nada. */
  exportarBase64: () => string | null;
  limpiar: () => void;
}

interface FirmaCanvasProps {
  onCambio?: (vacio: boolean) => void;
  className?: string;
}

export const FirmaCanvas = forwardRef<FirmaCanvasHandle, FirmaCanvasProps>(function FirmaCanvas(
  { onCambio, className },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const dibujando = useRef(false);
  const tieneTrazoRef = useRef(false);
  const puntoAnterior = useRef<{ x: number; y: number } | null>(null);
  const [vacio, setVacio] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const contenedor = contenedorRef.current;
    if (!canvas || !contenedor) return;

    function ajustarTamano() {
      const dpr = window.devicePixelRatio || 1;
      const rect = contenedor!.getBoundingClientRect();
      const anchoPx = Math.round(rect.width * dpr);
      const altoPx = Math.round(rect.height * dpr);
      // Evita re-limpiar el trazo si el ResizeObserver dispara sin que
      // el tamaño realmente haya cambiado (pasa en el primer layout).
      if (canvas!.width === anchoPx && canvas!.height === altoPx) return;
      canvas!.width = anchoPx;
      canvas!.height = altoPx;
      const ctx = canvas!.getContext("2d");
      if (ctx) {
        // setTransform en vez de scale: evita que la escala se acumule
        // si ajustarTamano se llama más de una vez.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = "#201F1D";
      }
    }

    ajustarTamano();
    const observer = new ResizeObserver(ajustarTamano);
    observer.observe(contenedor);
    return () => observer.disconnect();
  }, []);

  function posicionRelativa(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dibujando.current = true;
    puntoAnterior.current = posicionRelativa(e);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const actual = posicionRelativa(e);
    if (ctx && puntoAnterior.current) {
      ctx.beginPath();
      ctx.moveTo(puntoAnterior.current.x, puntoAnterior.current.y);
      ctx.lineTo(actual.x, actual.y);
      ctx.stroke();
    }
    puntoAnterior.current = actual;
    if (!tieneTrazoRef.current) {
      tieneTrazoRef.current = true;
      setVacio(false);
      onCambio?.(false);
    }
  }

  function onPointerUp() {
    dibujando.current = false;
    puntoAnterior.current = null;
  }

  function limpiar() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    tieneTrazoRef.current = false;
    setVacio(true);
    onCambio?.(true);
  }

  useImperativeHandle(ref, () => ({
    exportarBase64: () =>
      tieneTrazoRef.current ? (canvasRef.current?.toDataURL("image/png") ?? null) : null,
    limpiar,
  }));

  return (
    <div className={cn("space-y-2", className)}>
      <div
        ref={contenedorRef}
        className="relative h-40 w-full touch-none overflow-hidden rounded-2xl border border-borde bg-tarjeta"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          className="h-full w-full touch-none"
          aria-label="Área de firma — dibuja tu firma con el dedo o el mouse"
        />
        {vacio && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-grafito/30">
            Firma aquí
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={limpiar}
        disabled={vacio}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-grafito/50 disabled:opacity-40"
      >
        <Eraser className="h-3.5 w-3.5" /> Borrar firma
      </button>
    </div>
  );
});
