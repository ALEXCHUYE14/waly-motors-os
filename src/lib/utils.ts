import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { supabase } from "@/lib/supabase";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Sanea un término de búsqueda antes de interpolarlo en un filtro
 * `.or("col.ilike.%term%,...")` de PostgREST. La coma separa condiciones
 * y los paréntesis agrupan — un término de usuario que los traiga tal
 * cual (ej. buscar "Pérez, José" o un nombre con paréntesis) rompe la
 * sintaxis del filtro y la búsqueda falla con un 400 en vez de
 * simplemente no encontrar resultados.
 */
export function terminoBusquedaSeguro(termino: string): string {
  return termino.replace(/[,()]/g, "").trim();
}

export type BucketPrivado = "vehiculos" | "clientes" | "evidencias" | "contratos" | "garantias";

/**
 * Firma una URL de un objeto en un bucket privado (por defecto 1 hora).
 * Las tablas guardan la RUTA interna (`carpeta/archivo.jpg`),
 * nunca URLs públicas — los buckets son privados.
 * `segundos` se sube (ej. 7 días) para documentos que el cliente
 * puede querer reabrir más tarde, como el contrato en PDF.
 */
export async function urlFirmada(
  bucket: BucketPrivado,
  ruta: string,
  segundos = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(ruta, segundos);
  return error ? null : data.signedUrl;
}

/**
 * Firma varias rutas del mismo bucket en UNA sola llamada HTTP (en vez de
 * N llamadas individuales a urlFirmada). Úsalo siempre que se firmen fotos
 * de una lista — evita el patrón N+1 en listados de vehículos/clientes.
 * Devuelve un mapa ruta → URL firmada (usa el campo `path` que responde
 * Supabase, no el orden del array, que no está garantizado).
 */
export async function urlFirmadas(
  bucket: BucketPrivado,
  rutas: string[],
): Promise<Map<string, string>> {
  if (rutas.length === 0) return new Map();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(rutas, 3600);
  if (error || !data) return new Map();

  const mapa = new Map<string, string>();
  for (const d of data) {
    if (d.path && d.signedUrl) mapa.set(d.path, d.signedUrl);
  }
  return mapa;
}

/** Sube un archivo (imagen o PDF) y devuelve la ruta interna guardable en BD. */
export async function subirArchivo(
  bucket: BucketPrivado,
  carpeta: string,
  file: File,
): Promise<string> {
  const ruta = `${carpeta}/${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(ruta, file, { contentType: file.type });
  if (error) throw error;
  return ruta;
}

/** @deprecated usa `subirArchivo` — se mantiene como alias para no tocar cada llamada existente. */
export const subirImagen = subirArchivo;

/** Abre un chat de WhatsApp con un mensaje pre-redactado (API pública wa.me). */
export function abrirWhatsApp(telefono: string, mensaje: string): void {
  const numero = telefono.replace(/\D/g, ""); // "+51987..." → "51987..."
  window.open(
    `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`,
    "_blank",
    "noopener,noreferrer",
  );
}

// ── Logo del sistema (public/img/logo.png) ───────────────────
// Se carga una sola vez y se reutiliza — usado para incrustarlo en
// comprobantes y contratos en PDF. Si falla (offline, archivo ausente),
// el documento se genera igual, sin logo, nunca rompe la descarga/envío.
let logoSistemaPromise: Promise<HTMLImageElement | null> | null = null;

export function cargarLogoSistema(): Promise<HTMLImageElement | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!logoSistemaPromise) {
    logoSistemaPromise = new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
      img.onerror = () => resolve(null);
      img.src = "/img/logo.png";
    });
  }
  return logoSistemaPromise;
}

// ── Adjuntos de garantía incrustables en el PDF del contrato ─
export interface AdjuntoImagen {
  ruta: string;
  /** `null` si no es una imagen (ej. un PDF) o si la conversión falló —
   *  el contrato solo lista el nombre en vez de romperse. */
  dataUrl: string | null;
  ancho: number;
  alto: number;
}

const EXTENSIONES_IMAGEN = /\.(jpe?g|png|webp)$/i;

async function blobAAdjunto(blob: Blob, ruta: string): Promise<AdjuntoImagen> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(blob);
  });
  const { ancho, alto } = await new Promise<{ ancho: number; alto: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ ancho: img.naturalWidth, alto: img.naturalHeight });
    img.onerror = () => resolve({ ancho: 0, alto: 0 });
    img.src = dataUrl;
  });
  return { ruta, dataUrl, ancho, alto };
}

/** Descarga un documento de garantía ya subido al bucket `garantias` y lo
 *  convierte a data URL con sus dimensiones reales, para incrustarlo como
 *  imagen en el PDF del contrato sin deformarlo. Si no es imagen (ej. un
 *  PDF) o la descarga falla, devuelve `dataUrl: null`. */
export async function cargarAdjuntoGarantia(ruta: string): Promise<AdjuntoImagen> {
  if (!EXTENSIONES_IMAGEN.test(ruta)) return { ruta, dataUrl: null, ancho: 0, alto: 0 };
  try {
    const url = await urlFirmada("garantias", ruta);
    if (!url) return { ruta, dataUrl: null, ancho: 0, alto: 0 };
    const res = await fetch(url);
    if (!res.ok) return { ruta, dataUrl: null, ancho: 0, alto: 0 };
    return await blobAAdjunto(await res.blob(), ruta);
  } catch {
    return { ruta, dataUrl: null, ancho: 0, alto: 0 };
  }
}

/** Igual que `cargarAdjuntoGarantia`, pero para un archivo recién elegido
 *  (todavía no subido) — se usa al crear el contrato, donde el `File` ya
 *  está en memoria y no hace falta ir a buscarlo a Supabase. */
export async function archivoLocalAAdjunto(file: File): Promise<AdjuntoImagen> {
  if (!file.type.startsWith("image/")) return { ruta: file.name, dataUrl: null, ancho: 0, alto: 0 };
  try {
    return await blobAAdjunto(file, file.name);
  } catch {
    return { ruta: file.name, dataUrl: null, ancho: 0, alto: 0 };
  }
}
