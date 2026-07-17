/**
 * WALY MOTORS OS — Skeleton compartido para loading.tsx
 * ───────────────────────────────────────────────────────
 * Server Component: se muestra de inmediato al navegar mientras el
 * componente cliente de la sección hidrata y hace su primer fetch —
 * evita la pantalla en blanco que hacía sentir lenta la navegación.
 */

export function PantallaCargando({ filas = 4 }: { filas?: number }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6" aria-busy="true" aria-label="Cargando">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-neutral-200/60 dark:bg-neutral-800/60" />
      <div className="space-y-3">
        {Array.from({ length: filas }, (_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-2xl bg-neutral-200/60 dark:bg-neutral-800/60"
          />
        ))}
      </div>
    </div>
  );
}
