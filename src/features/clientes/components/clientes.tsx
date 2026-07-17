"use client";

/**
 * WALY MOTORS OS — Módulo Clientes
 * Listado con búsqueda + formulario alta/edición con validación
 * peruana (DNI 8 dígitos / RUC 11) y foto de perfil o documento
 * capturada con la cámara nativa.
 */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, Plus, Search, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, subirImagen, urlFirmada, urlFirmadas } from "@/lib/utils";

// ── Tipos y hooks ────────────────────────────────────────────
export interface Cliente {
  id: string;
  tipo_documento: "DNI" | "RUC";
  numero_documento: string;
  nombre_completo: string;
  telefono: string | null;
  direccion: string | null;
  referencia: string | null;
  foto_perfil: string | null;
  fotoFirmada?: string | null;
}

function useClientes(termino: string) {
  const [debounced, setDebounced] = useState(termino);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(termino), 300);
    return () => clearTimeout(t);
  }, [termino]);

  return useQuery({
    queryKey: ["clientes", debounced],
    // La mutación de guardar cliente ya invalida esta key explícitamente.
    staleTime: 60_000,
    queryFn: async (): Promise<Cliente[]> => {
      let q = supabase.from("clientes").select("*").order("nombre_completo").limit(50);
      const t = debounced.trim();
      if (t.length >= 2) {
        q = q.or(`nombre_completo.ilike.%${t}%,numero_documento.like.${t}%`);
      }
      const { data, error } = await q;
      if (error) throw error;

      // UNA sola llamada HTTP para firmar las fotos de toda la lista
      // (antes: 1 llamada por cliente → N requests).
      const rutas = (data ?? []).map((c) => c.foto_perfil).filter(Boolean) as string[];
      const urlPorRuta = await urlFirmadas("clientes", rutas);

      return (data ?? []).map((c) => ({
        ...c,
        fotoFirmada: c.foto_perfil ? urlPorRuta.get(c.foto_perfil) ?? null : null,
      }));
    },
  });
}

function useCliente(id: string) {
  return useQuery({
    queryKey: ["cliente", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<Cliente> => {
      const { data, error } = await supabase.from("clientes").select("*").eq("id", id).single();
      if (error) throw error;
      return {
        ...data,
        fotoFirmada: data.foto_perfil ? await urlFirmada("clientes", data.foto_perfil) : null,
      };
    },
  });
}

interface DatosCliente {
  tipoDocumento: "DNI" | "RUC";
  numeroDocumento: string;
  nombreCompleto: string;
  telefono: string;
  direccion: string;
  referencia: string;
  nuevaFoto: File | null;
  fotoExistente: string | null;
}

function useGuardarCliente(idExistente?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (d: DatosCliente) => {
      let rutaFoto = d.fotoExistente;
      if (d.nuevaFoto) {
        rutaFoto = await subirImagen("clientes", d.numeroDocumento, d.nuevaFoto);
      }

      const registro = {
        tipo_documento: d.tipoDocumento,
        numero_documento: d.numeroDocumento.trim(),
        nombre_completo: d.nombreCompleto.trim(),
        telefono: d.telefono ? `+51${d.telefono.replace(/\D/g, "").slice(-9)}` : null,
        direccion: d.direccion.trim() || null,
        referencia: d.referencia.trim() || null,
        foto_perfil: rutaFoto,
      };

      const q = idExistente
        ? supabase.from("clientes").update(registro).eq("id", idExistente)
        : supabase.from("clientes").insert(registro);

      const { data, error } = await q.select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clientes"] });
      if (idExistente) void queryClient.invalidateQueries({ queryKey: ["cliente", idExistente] });
    },
  });
}

// ═════════════════════════════════════════════════════════════
// LISTADO
// ═════════════════════════════════════════════════════════════
export function ListaClientes() {
  const router = useRouter();
  const [termino, setTermino] = useState("");
  const clientes = useClientes(termino);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-black uppercase tracking-tight text-grafito">Clientes</h1>
        <button
          type="button"
          onClick={() => router.push("/clientes/nuevo")}
          className="flex items-center gap-1.5 rounded-xl bg-cobre px-4 py-2.5 text-sm font-bold text-white active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" strokeWidth={3} /> Registrar
        </button>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-grafito/30" />
        <input
          type="search"
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
          placeholder="Buscar por nombre o documento…"
          aria-label="Buscar cliente"
          className="w-full rounded-2xl border border-borde bg-tarjeta py-3.5 pl-11 pr-4 text-grafito focus-visible:outline-2 focus-visible:outline-amarillo"
        />
      </div>

      {clientes.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-borde/60" />
          ))}
        </div>
      ) : clientes.data && clientes.data.length > 0 ? (
        <ul className="space-y-2">
          {clientes.data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => router.push(`/clientes/${c.id}`)}
                className="flex w-full items-center gap-3 rounded-2xl border border-borde bg-tarjeta p-3 text-left shadow-card active:scale-[0.99]"
              >
                <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-fondo">
                  {c.fotoFirmada ? (
                    <Image src={c.fotoFirmada} alt="" fill className="object-cover" sizes="44px" />
                  ) : (
                    <UserRound className="m-auto h-full w-5 text-grafito/30" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-grafito">{c.nombre_completo}</span>
                  <span className="block text-xs text-grafito/50">
                    {c.tipo_documento} <span className="font-mono">{c.numero_documento}</span>
                    {c.telefono && ` · ${c.telefono}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-borde p-6 text-center text-sm text-grafito/50">
          {termino ? `Sin resultados para «${termino}».` : "Aún no hay clientes registrados."}
        </p>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// FORMULARIO
// ═════════════════════════════════════════════════════════════
export function FormularioCliente({ id }: { id?: string }) {
  const router = useRouter();
  const existente = useCliente(id ?? "");
  const guardar = useGuardarCliente(id);

  const [tipoDoc, setTipoDoc] = useState<"DNI" | "RUC">("DNI");
  const [numDoc, setNumDoc] = useState("");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [direccion, setDireccion] = useState("");
  const [referencia, setReferencia] = useState("");
  const [fotoExistente, setFotoExistente] = useState<string | null>(null);
  const [fotoFirmada, setFotoFirmada] = useState<string | null>(null);
  const [nuevaFoto, setNuevaFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputFoto = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const c = existente.data;
    if (!id || !c) return;
    setTipoDoc(c.tipo_documento);
    setNumDoc(c.numero_documento);
    setNombre(c.nombre_completo);
    setTelefono(c.telefono?.replace("+51", "") ?? "");
    setDireccion(c.direccion ?? "");
    setReferencia(c.referencia ?? "");
    setFotoExistente(c.foto_perfil);
    setFotoFirmada(c.fotoFirmada ?? null);
  }, [id, existente.data]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Validación peruana espejo de los CHECK de la BD
  const docValido =
    tipoDoc === "DNI" ? /^\d{8}$/.test(numDoc) : /^(10|20)\d{9}$/.test(numDoc);
  const telValido = telefono === "" || /^9\d{8}$/.test(telefono.replace(/\D/g, ""));
  const valido = docValido && nombre.trim().length >= 3 && telValido;

  function onFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setNuevaFoto(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  function onGuardar() {
    if (!valido) return;
    guardar.mutate(
      {
        tipoDocumento: tipoDoc,
        numeroDocumento: numDoc,
        nombreCompleto: nombre,
        telefono,
        direccion,
        referencia,
        nuevaFoto,
        fotoExistente,
      },
      { onSuccess: () => router.push("/clientes") },
    );
  }

  const campo =
    "mt-1 w-full rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-grafito focus-visible:outline-2 focus-visible:outline-amarillo";
  const etiqueta = "text-[11px] font-semibold uppercase tracking-widest text-grafito/40";
  const fotoActual = preview ?? fotoFirmada;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md space-y-5 p-4 sm:p-6"
    >
      <h1 className="text-lg font-black uppercase tracking-tight text-grafito">
        {id ? "Editar cliente" : "Nuevo cliente"}
      </h1>

      {/* Foto perfil / documento */}
      <input
        ref={inputFoto}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFoto}
        className="sr-only"
        aria-label="Capturar foto del cliente o su documento"
      />
      <button
        type="button"
        onClick={() => inputFoto.current?.click()}
        className="relative mx-auto block h-28 w-28 overflow-hidden rounded-3xl border-2 border-dashed border-borde bg-fondo"
      >
        {fotoActual ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fotoActual} alt="Foto del cliente" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-grafito/30">
            <Camera className="h-7 w-7" />
          </span>
        )}
      </button>
      <p className="text-center text-xs text-grafito/50">
        Toca para tomar la foto del cliente o de su {tipoDoc}.
      </p>

      {/* Documento */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <span className={etiqueta}>Tipo</span>
          <div className="mt-1 grid gap-1">
            {(["DNI", "RUC"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tipoDoc === t}
                onClick={() => setTipoDoc(t)}
                className={cn(
                  "rounded-xl border py-2 text-xs font-bold",
                  tipoDoc === t
                    ? "border-cobre bg-cobre/10 text-cobre"
                    : "border-borde text-grafito/50",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="col-span-2">
          <label className={etiqueta} htmlFor="doc">
            N° de {tipoDoc} {numDoc && !docValido && (
              <span className="normal-case text-oxido">
                — {tipoDoc === "DNI" ? "8 dígitos" : "11 dígitos, inicia en 10 o 20"}
              </span>
            )}
          </label>
          <input
            id="doc"
            inputMode="numeric"
            maxLength={tipoDoc === "DNI" ? 8 : 11}
            value={numDoc}
            onChange={(e) => setNumDoc(e.target.value.replace(/\D/g, ""))}
            className={cn(campo, "font-mono font-bold")}
          />
        </div>
      </div>

      <div>
        <label className={etiqueta} htmlFor="nombre">Nombre completo</label>
        <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className={campo} />
      </div>

      <div>
        <label className={etiqueta} htmlFor="tel">
          Celular {telefono && !telValido && (
            <span className="normal-case text-oxido">— 9 dígitos, empieza en 9</span>
          )}
        </label>
        <div className="mt-1 flex">
          <span className="flex items-center rounded-l-2xl border border-r-0 border-borde bg-fondo px-3 font-mono text-sm font-bold text-grafito">
            +51
          </span>
          <input
            id="tel"
            inputMode="tel"
            maxLength={9}
            value={telefono}
            onChange={(e) => setTelefono(e.target.value.replace(/\D/g, ""))}
            placeholder="987654321"
            className="w-full rounded-r-2xl border border-borde bg-tarjeta px-4 py-3 font-mono text-grafito focus-visible:outline-2 focus-visible:outline-amarillo"
          />
        </div>
      </div>

      <div>
        <label className={etiqueta} htmlFor="dir">Dirección</label>
        <input id="dir" value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle Comercio 123, Catacaos" className={campo} />
      </div>

      <div>
        <label className={etiqueta} htmlFor="ref">Referencia</label>
        <input id="ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="A dos cuadras de la plaza" className={campo} />
      </div>

      {guardar.isError && (
        <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">
          {guardar.error instanceof Error && /duplicate|unique/i.test(guardar.error.message)
            ? `Ya existe un cliente con ese ${tipoDoc}.`
            : "No se pudo guardar. Revisa los datos e intenta de nuevo."}
        </p>
      )}

      <button
        type="button"
        disabled={!valido || guardar.isPending}
        onClick={onGuardar}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amarillo py-4 font-bold text-grafito active:scale-[0.98] disabled:opacity-40"
      >
        {guardar.isPending ? "Guardando…" : <><Check className="h-5 w-5" strokeWidth={3} /> Guardar cliente</>}
      </button>
    </motion.div>
  );
}
