"use client";

/**
 * WALY MOTORS OS — Módulo Repuestos (inventario de taller)
 * Listado con búsqueda y alerta de stock bajo + formulario de
 * datos maestros + registro de entradas/salidas con historial.
 * El stock solo cambia vía `registrar_movimiento_repuesto` (RPC
 * atómica) — nunca se edita directo, para mantener trazabilidad.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowDownCircle, ArrowUpCircle, Check, Package, Plus, Search, TriangleAlert } from "lucide-react";
import { soles } from "@/lib/supabase";
import {
  useRepuestos,
  useRepuesto,
  useGuardarRepuesto,
  useMovimientosRepuesto,
  useRegistrarMovimiento,
  type Repuesto,
  type TipoMovimiento,
} from "@/features/repuestos/hooks/use-repuestos";
import { cn, mensajeError, esErrorDuplicado } from "@/lib/utils";

const fechaHora = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// ═════════════════════════════════════════════════════════════
// LISTADO
// ═════════════════════════════════════════════════════════════
export function ListaRepuestos() {
  const router = useRouter();
  const [termino, setTermino] = useState("");
  const repuestos = useRepuestos(termino);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-black uppercase tracking-tight text-grafito">Repuestos</h1>
        <button
          type="button"
          onClick={() => router.push("/repuestos/nuevo")}
          className="flex items-center gap-1.5 rounded-xl bg-cobre px-4 py-2.5 text-sm font-bold text-white active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" strokeWidth={3} /> Agregar
        </button>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-grafito/30" />
        <input
          type="search"
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
          placeholder="Buscar por nombre o código…"
          aria-label="Buscar repuesto"
          className="w-full rounded-2xl border border-borde bg-tarjeta py-3.5 pl-11 pr-4 text-grafito focus-visible:outline-2 focus-visible:outline-amarillo"
        />
      </div>

      {repuestos.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-borde/60" />)}
        </div>
      ) : repuestos.data && repuestos.data.length > 0 ? (
        <ul className="space-y-2">
          {repuestos.data.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => router.push(`/repuestos/${r.id}`)}
                className="flex w-full items-center gap-3 rounded-2xl border border-borde bg-tarjeta p-3 text-left shadow-card active:scale-[0.99]"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cobre/10 text-cobre">
                  <Package className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-grafito">{r.nombre}</span>
                  <span className="block text-xs text-grafito/50">
                    {r.codigo && <span className="font-mono">{r.codigo}</span>}
                    {r.codigo && r.categoria && " · "}
                    {r.categoria}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold",
                    r.stock <= r.stock_minimo ? "bg-oxido/15 text-oxido" : "bg-emerald-500/15 text-emerald-600",
                  )}
                >
                  {r.stock} {r.unidad}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-borde p-6 text-center text-sm text-grafito/50">
          {termino ? `Sin resultados para «${termino}».` : "Aún no hay repuestos registrados."}
        </p>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// FORMULARIO (alta y edición comparten componente)
// ═════════════════════════════════════════════════════════════
export function FormularioRepuesto({ id }: { id?: string }) {
  const router = useRouter();
  const existente = useRepuesto(id ?? "");
  const guardar = useGuardarRepuesto(id);

  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [stockMinimo, setStockMinimo] = useState("0");
  const [costoUnitario, setCostoUnitario] = useState("");
  const [unidad, setUnidad] = useState("unidad");

  useEffect(() => {
    const r = existente.data;
    if (!id || !r) return;
    setNombre(r.nombre);
    setCodigo(r.codigo ?? "");
    setCategoria(r.categoria ?? "");
    setStockMinimo(String(r.stock_minimo));
    setCostoUnitario(r.costo_unitario != null ? String(r.costo_unitario) : "");
    setUnidad(r.unidad);
  }, [id, existente.data]);

  const valido = nombre.trim().length >= 2;

  function onGuardar() {
    if (!valido) return;
    guardar.mutate(
      {
        nombre,
        codigo,
        categoria,
        stockMinimo: Number(stockMinimo) || 0,
        costoUnitario: costoUnitario ? Number(costoUnitario) : null,
        unidad,
      },
      {
        onSuccess: (data) => {
          if (!id) router.push(`/repuestos/${data.id}`);
        },
      },
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
        {id ? "Editar repuesto" : "Nuevo repuesto"}
      </h1>

      <div>
        <label className={etiqueta} htmlFor="nombre">Nombre</label>
        <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Filtro de aceite" className={campo} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={etiqueta} htmlFor="codigo">Código (opcional)</label>
          <input id="codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} className={cn(campo, "font-mono")} />
        </div>
        <div>
          <label className={etiqueta} htmlFor="categoria">Categoría</label>
          <input id="categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Motor" className={campo} />
        </div>
        <div>
          <label className={etiqueta} htmlFor="unidad">Unidad</label>
          <input id="unidad" value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="unidad, litro, juego…" className={campo} />
        </div>
        <div>
          <label className={etiqueta} htmlFor="stock-min">Stock mínimo</label>
          <input id="stock-min" type="number" inputMode="numeric" value={stockMinimo} onChange={(e) => setStockMinimo(e.target.value)} className={campo} />
        </div>
        <div className="col-span-2">
          <label className={etiqueta} htmlFor="costo">Costo unitario S/. (opcional)</label>
          <input id="costo" type="number" inputMode="decimal" value={costoUnitario} onChange={(e) => setCostoUnitario(e.target.value)} className={campo} />
        </div>
      </div>

      {!id && (
        <p className="rounded-xl bg-cobre/10 p-3 text-xs text-grafito/70">
          El stock inicia en 0. Después de crear el repuesto podrás registrar la entrada de stock inicial.
        </p>
      )}

      {guardar.isError && (
        <p className="rounded-xl bg-oxido/10 p-3 text-sm font-medium text-oxido">
          {esErrorDuplicado(guardar.error)
            ? "Ya existe un repuesto con ese código."
            : mensajeError(guardar.error, "No se pudo guardar. Revisa los datos e intenta de nuevo.")}
        </p>
      )}

      <button
        type="button"
        disabled={!valido || guardar.isPending}
        onClick={onGuardar}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amarillo py-4 font-bold text-grafito active:scale-[0.98] disabled:opacity-40"
      >
        {guardar.isPending ? "Guardando…" : <><Check className="h-5 w-5" strokeWidth={3} /> Guardar repuesto</>}
      </button>

      {id && existente.data && <SeccionMovimientos repuesto={existente.data} />}
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════
// MOVIMIENTOS DE STOCK
// ═════════════════════════════════════════════════════════════
function SeccionMovimientos({ repuesto }: { repuesto: Repuesto }) {
  const movimientos = useMovimientosRepuesto(repuesto.id);
  const registrar = useRegistrarMovimiento(repuesto.id);

  const [tipo, setTipo] = useState<TipoMovimiento>("entrada");
  const [cantidad, setCantidad] = useState("1");
  const [motivo, setMotivo] = useState("");

  const cantidadValida = Number(cantidad) > 0;

  function onRegistrar() {
    if (!cantidadValida) return;
    registrar.mutate(
      { tipo, cantidad: Number(cantidad), motivo },
      { onSuccess: () => { setCantidad("1"); setMotivo(""); } },
    );
  }

  return (
    <div className="space-y-4 border-t border-borde pt-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-black uppercase tracking-wide text-grafito">Stock actual</p>
        <span
          className={cn(
            "rounded-lg px-3 py-1 text-sm font-black",
            repuesto.stock <= repuesto.stock_minimo ? "bg-oxido/15 text-oxido" : "bg-emerald-500/15 text-emerald-600",
          )}
        >
          {repuesto.stock} {repuesto.unidad}
        </span>
      </div>
      {repuesto.stock <= repuesto.stock_minimo && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-oxido">
          <TriangleAlert className="h-3.5 w-3.5" /> Por debajo del stock mínimo ({repuesto.stock_minimo} {repuesto.unidad})
        </p>
      )}

      <div className="space-y-3 rounded-2xl border border-borde bg-tarjeta p-4 shadow-card">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={tipo === "entrada"}
            onClick={() => setTipo("entrada")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-semibold",
              tipo === "entrada" ? "border-emerald-500 bg-emerald-500/10 text-emerald-600" : "border-borde text-grafito/50",
            )}
          >
            <ArrowDownCircle className="h-4 w-4" /> Entrada
          </button>
          <button
            type="button"
            aria-pressed={tipo === "salida"}
            onClick={() => setTipo("salida")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-semibold",
              tipo === "salida" ? "border-oxido bg-oxido/10 text-oxido" : "border-borde text-grafito/50",
            )}
          >
            <ArrowUpCircle className="h-4 w-4" /> Salida
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-widest text-grafito/40" htmlFor="cant-mov">
              Cantidad
            </label>
            <input
              id="cant-mov"
              type="number"
              inputMode="numeric"
              min="1"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="mt-1 w-full rounded-xl border border-borde bg-fondo px-3 py-2.5 font-bold text-grafito focus-visible:outline-2 focus-visible:outline-amarillo"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-widest text-grafito/40" htmlFor="motivo-mov">
              Motivo (opcional)
            </label>
            <input
              id="motivo-mov"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Compra, uso en taller…"
              className="mt-1 w-full rounded-xl border border-borde bg-fondo px-3 py-2.5 text-grafito focus-visible:outline-2 focus-visible:outline-amarillo"
            />
          </div>
        </div>
        {registrar.isError && (
          <p className="rounded-xl bg-oxido/10 p-2.5 text-xs font-medium text-oxido">
            {mensajeError(registrar.error, "No se pudo registrar el movimiento.")}
          </p>
        )}
        <button
          type="button"
          disabled={!cantidadValida || registrar.isPending}
          onClick={onRegistrar}
          className="w-full rounded-xl bg-amarillo py-3 text-sm font-bold text-grafito active:scale-[0.98] disabled:opacity-40"
        >
          {registrar.isPending ? "Guardando…" : "Registrar movimiento"}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-black uppercase tracking-wide text-grafito">Historial</p>
        {movimientos.isLoading ? (
          <div className="h-14 animate-pulse rounded-2xl bg-borde/60" />
        ) : movimientos.data && movimientos.data.length > 0 ? (
          <ul className="space-y-2">
            {movimientos.data.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-xl border border-borde bg-tarjeta p-2.5 text-sm shadow-card">
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                    m.tipo === "entrada" ? "bg-emerald-500/15 text-emerald-600" : "bg-oxido/15 text-oxido",
                  )}
                >
                  {m.tipo === "entrada" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-grafito">
                    {m.tipo === "entrada" ? "+" : "−"}{m.cantidad} {repuesto.unidad}
                    {m.motivo && <span className="font-normal text-grafito/60"> · {m.motivo}</span>}
                  </span>
                  <span className="block text-xs text-grafito/50">
                    {fechaHora.format(new Date(m.created_at))}
                    {m.perfiles?.nombre && ` · ${m.perfiles.nombre}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-borde p-4 text-center text-sm text-grafito/50">
            Sin movimientos todavía.
          </p>
        )}
      </div>
    </div>
  );
}
