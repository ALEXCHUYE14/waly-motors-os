"use client";

/**
 * WALY MOTORS OS — Módulo Vehículos
 * Listado con filtros por estado + formulario alta/edición
 * con galería de fotos (cámara nativa o galería del teléfono).
 */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Bike, Camera, Check, Plus, Trash2, Wrench } from "lucide-react";
import { soles, type EstadoVehiculo } from "@/lib/supabase";
import {
  useVehiculos,
  useVehiculo,
  useGuardarVehiculo,
  useCambiarEstadoVehiculo,
  useVehiculosAlertaMantenimiento,
  type Vehiculo,
} from "@/features/vehiculos/hooks/use-vehiculos";
import { TabMantenimiento } from "@/features/vehiculos/components/mantenimiento";
import { cn } from "@/lib/utils";

// ── Estados con semántica visual ─────────────────────────────
const ESTADOS: { id: EstadoVehiculo | "todos"; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "disponible", label: "Disponibles" },
  { id: "alquilado", label: "Alquiladas" },
  { id: "en_mantenimiento", label: "Taller" },
  { id: "vendido", label: "Vendidas" },
];

// Mismo semáforo que ya usan los estados de pago (completado/parcial/
// rechazado en detalle-contrato.tsx): verde=OK, amarillo=activo, óxido=
// requiere atención, gris=cerrado. En mantenimiento usa óxido (no un azul
// ajeno a la paleta) porque significa "fuera de servicio", no "activo".
const COLOR_ESTADO: Record<EstadoVehiculo, string> = {
  disponible: "bg-emerald-500/15 text-emerald-600",
  alquilado: "bg-amarillo/25 text-grafito",
  en_mantenimiento: "bg-oxido/15 text-oxido",
  vendido: "bg-grafito/10 text-grafito/60",
};

const LABEL_ESTADO: Record<EstadoVehiculo, string> = {
  disponible: "Disponible",
  alquilado: "Alquilada",
  en_mantenimiento: "En taller",
  vendido: "Vendida",
};

// ═════════════════════════════════════════════════════════════
// LISTADO
// ═════════════════════════════════════════════════════════════
export function ListaVehiculos() {
  const router = useRouter();
  const [filtro, setFiltro] = useState<EstadoVehiculo | "todos">("todos");
  const vehiculos = useVehiculos(filtro);
  const cambiarEstado = useCambiarEstadoVehiculo();
  const alertas = useVehiculosAlertaMantenimiento();
  const idsEnAlerta = new Set((alertas.data ?? []).map((a) => a.vehiculo_id));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-black uppercase tracking-tight text-grafito">Flota</h1>
        <button
          type="button"
          onClick={() => router.push("/vehiculos/nuevo")}
          className="flex items-center gap-1.5 rounded-xl bg-cobre px-4 py-2.5 text-sm font-bold text-white active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" strokeWidth={3} /> Agregar
        </button>
      </header>

      {/* Filtros */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {ESTADOS.map((e) => (
          <button
            key={e.id}
            type="button"
            aria-pressed={filtro === e.id}
            onClick={() => setFiltro(e.id)}
            className={cn(
              "shrink-0 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors",
              filtro === e.id
                ? "border-cobre bg-cobre/10 text-cobre"
                : "border-borde text-grafito/50",
            )}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {vehiculos.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-borde/60" />
          ))}
        </div>
      ) : vehiculos.data && vehiculos.data.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {vehiculos.data.map((v) => (
            <TarjetaVehiculo
              key={v.id}
              vehiculo={v}
              enAlerta={idsEnAlerta.has(v.id)}
              onEditar={() => router.push(`/vehiculos/${v.id}`)}
              onTaller={
                v.estado === "disponible"
                  ? () => cambiarEstado.mutate({ id: v.id, estado: "en_mantenimiento" })
                  : v.estado === "en_mantenimiento"
                    ? () => cambiarEstado.mutate({ id: v.id, estado: "disponible" })
                    : undefined
              }
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-borde p-6 text-center text-sm text-grafito/50">
          No hay mototaxis en este filtro. Agrega la primera con el botón de arriba.
        </p>
      )}
    </div>
  );
}

function TarjetaVehiculo({
  vehiculo: v,
  enAlerta,
  onEditar,
  onTaller,
}: {
  vehiculo: Vehiculo;
  enAlerta: boolean;
  onEditar: () => void;
  onTaller?: () => void;
}) {
  return (
    <li className="overflow-hidden rounded-2xl border border-borde bg-tarjeta shadow-card">
      <button type="button" onClick={onEditar} className="block w-full text-left">
        <div className="relative aspect-video bg-fondo">
          {v.fotosFirmadas?.[0] ? (
            <Image src={v.fotosFirmadas[0]} alt={`${v.modelo} placa ${v.placa}`} fill className="object-cover" sizes="(min-width:640px) 50vw, 100vw" />
          ) : (
            <Bike className="absolute inset-0 m-auto h-10 w-10 text-grafito/25" />
          )}
          <span className={cn("absolute left-2 top-2 rounded-lg px-2 py-1 text-[11px] font-bold backdrop-blur", COLOR_ESTADO[v.estado])}>
            {LABEL_ESTADO[v.estado]}
          </span>
          {enAlerta && (
            <span
              title="Necesita mantenimiento"
              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-oxido text-white backdrop-blur"
            >
              <Wrench className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
        <div className="p-3">
          <p className="font-mono text-lg font-black text-grafito">{v.placa}</p>
          <p className="text-sm text-grafito/50">
            {v.modelo} {v.anio} · {v.kilometraje.toLocaleString("es-PE")} km
          </p>
          <p className="mt-1 text-xs font-semibold text-grafito/70">
            {v.precio_alquiler_diario && `${soles.format(v.precio_alquiler_diario)}/día`}
            {v.precio_alquiler_diario && v.precio_venta && " · "}
            {v.precio_venta && `Venta ${soles.format(v.precio_venta)}`}
          </p>
        </div>
      </button>

      {onTaller && (
        <button
          type="button"
          onClick={onTaller}
          className="flex w-full items-center justify-center gap-1.5 border-t border-borde py-2.5 text-xs font-semibold text-oxido"
        >
          <Wrench className="h-3.5 w-3.5" />
          {v.estado === "disponible" ? "Enviar a taller" : "Sacar del taller"}
        </button>
      )}
    </li>
  );
}

// ═════════════════════════════════════════════════════════════
// FORMULARIO (alta y edición comparten componente)
// ═════════════════════════════════════════════════════════════
export function FormularioVehiculo({ id }: { id?: string }) {
  const router = useRouter();
  const existente = useVehiculo(id ?? "");
  const guardar = useGuardarVehiculo(id);

  const [tab, setTab] = useState<"datos" | "mantenimiento">("datos");
  const [placa, setPlaca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [chasis, setChasis] = useState("");
  const [precioAlq, setPrecioAlq] = useState("");
  const [precioVenta, setPrecioVenta] = useState("");
  const [km, setKm] = useState("0");
  const [fotosExistentes, setFotosExistentes] = useState<string[]>([]);
  const [fotosFirmadas, setFotosFirmadas] = useState<string[]>([]);
  const [nuevasFotos, setNuevasFotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const inputFotos = useRef<HTMLInputElement>(null);

  // Precargar en edición
  useEffect(() => {
    const v = existente.data;
    if (!id || !v) return;
    setPlaca(v.placa);
    setModelo(v.modelo);
    setAnio(String(v.anio));
    setChasis(v.numero_chasis);
    setPrecioAlq(v.precio_alquiler_diario ? String(v.precio_alquiler_diario) : "");
    setPrecioVenta(v.precio_venta ? String(v.precio_venta) : "");
    setKm(String(v.kilometraje));
    setFotosExistentes(v.fotos);
    setFotosFirmadas(v.fotosFirmadas ?? []);
  }, [id, existente.data]);

  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const valido =
    /^[A-Z0-9-]{6,8}$/i.test(placa.trim()) &&
    modelo.trim().length >= 2 &&
    chasis.trim().length >= 5 &&
    Number(anio) >= 1990;

  function agregarFotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setNuevasFotos((prev) => [...prev, ...files]);
    setPreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))]);
    e.target.value = "";
  }

  function quitarExistente(idx: number) {
    setFotosExistentes((p) => p.filter((_, i) => i !== idx));
    setFotosFirmadas((p) => p.filter((_, i) => i !== idx));
  }

  function quitarNueva(idx: number) {
    URL.revokeObjectURL(previews[idx]);
    setNuevasFotos((p) => p.filter((_, i) => i !== idx));
    setPreviews((p) => p.filter((_, i) => i !== idx));
  }

  function onGuardar() {
    if (!valido) return;
    guardar.mutate(
      {
        placa,
        modelo,
        anio: Number(anio),
        numeroChasis: chasis,
        precioAlquilerDiario: precioAlq ? Number(precioAlq) : null,
        precioVenta: precioVenta ? Number(precioVenta) : null,
        kilometraje: Number(km) || 0,
        nuevasFotos,
        fotosExistentes,
      },
      { onSuccess: () => router.push("/vehiculos") },
    );
  }

  const campo =
    "mt-1 w-full rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-grafito focus-visible:outline-2 focus-visible:outline-amarillo";
  const etiqueta = "text-[11px] font-semibold uppercase tracking-widest text-grafito/40";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md space-y-5 p-4 sm:p-6"
    >
      <h1 className="text-lg font-black uppercase tracking-tight text-grafito">
        {id ? "Editar mototaxi" : "Nueva mototaxi"}
      </h1>

      {id && (
        <div className="flex gap-2 rounded-2xl border border-borde bg-tarjeta p-1">
          {(
            [
              { id: "datos", label: "Datos" },
              { id: "mantenimiento", label: "Mantenimiento" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 rounded-xl py-2 text-sm font-semibold transition-colors",
                tab === t.id ? "bg-cobre/10 text-cobre" : "text-grafito/50",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {id && tab === "mantenimiento" ? (
        existente.data ? (
          // Se usa el km recién cargado de la API, no el estado local `km`
          // del formulario: ese solo se sincroniza via efecto después del
          // primer render, y TabMantenimiento fija su valor inicial una
          // sola vez al montar — si el asesor cambia a esta pestaña antes
          // de que el efecto corra, quedaría con "0" para siempre.
          <TabMantenimiento vehiculoId={id} kilometrajeActual={existente.data.kilometraje} />
        ) : (
          <div className="h-40 animate-pulse rounded-2xl bg-borde/60" />
        )
      ) : (
        <>
          {/* Galería */}
          <input
            ref={inputFotos}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={agregarFotos}
            className="sr-only"
            aria-label="Agregar fotos del vehículo"
          />
          <div className="grid grid-cols-3 gap-2">
            {fotosFirmadas.map((url, i) => (
              <FotoGaleria key={`e-${i}`} url={url} onQuitar={() => quitarExistente(i)} />
            ))}
            {previews.map((url, i) => (
              <FotoGaleria key={`n-${i}`} url={url} onQuitar={() => quitarNueva(i)} />
            ))}
            <button
              type="button"
              onClick={() => inputFotos.current?.click()}
              className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-borde text-grafito/40"
              aria-label="Agregar foto"
            >
              <Camera className="h-6 w-6" />
            </button>
          </div>

          {/* Datos */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={etiqueta} htmlFor="placa">Placa</label>
              <input id="placa" value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="M2X-745" className={cn(campo, "font-mono font-black uppercase")} />
            </div>
            <div>
              <label className={etiqueta} htmlFor="anio">Año</label>
              <input id="anio" type="number" inputMode="numeric" value={anio} onChange={(e) => setAnio(e.target.value)} className={campo} />
            </div>
            <div className="col-span-2">
              <label className={etiqueta} htmlFor="modelo">Modelo</label>
              <input id="modelo" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Bajaj Torito RE 4T" className={campo} />
            </div>
            <div className="col-span-2">
              <label className={etiqueta} htmlFor="chasis">N° de chasis</label>
              <input id="chasis" value={chasis} onChange={(e) => setChasis(e.target.value.toUpperCase())} className={cn(campo, "font-mono uppercase")} />
            </div>
            <div>
              <label className={etiqueta} htmlFor="palq">Alquiler S/./día</label>
              <input id="palq" type="number" inputMode="decimal" value={precioAlq} onChange={(e) => setPrecioAlq(e.target.value)} className={campo} />
            </div>
            <div>
              <label className={etiqueta} htmlFor="pven">Precio venta S/.</label>
              <input id="pven" type="number" inputMode="decimal" value={precioVenta} onChange={(e) => setPrecioVenta(e.target.value)} className={campo} />
            </div>
            <div className="col-span-2">
              <label className={etiqueta} htmlFor="km">Kilometraje</label>
              <input id="km" type="number" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} className={campo} />
            </div>
          </div>

          {guardar.isError && (
            <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">
              {guardar.error instanceof Error && /duplicate|unique/i.test(guardar.error.message)
                ? "Ya existe una mototaxi con esa placa o número de chasis."
                : "No se pudo guardar. Revisa los datos e intenta de nuevo."}
            </p>
          )}

          <button
            type="button"
            disabled={!valido || guardar.isPending}
            onClick={onGuardar}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amarillo py-4 font-bold text-grafito active:scale-[0.98] disabled:opacity-40"
          >
            {guardar.isPending ? "Guardando…" : <><Check className="h-5 w-5" strokeWidth={3} /> Guardar mototaxi</>}
          </button>
        </>
      )}
    </motion.div>
  );
}

function FotoGaleria({ url, onQuitar }: { url: string; onQuitar: () => void }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-cover" />
      <button
        type="button"
        onClick={onQuitar}
        aria-label="Quitar foto"
        className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-lg bg-grafito/70 text-white"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
