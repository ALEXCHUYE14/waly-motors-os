# WALY MOTORS OS

Sistema de gestión para alquiler y venta de mototaxis — Waldir Yarlequé.
Next.js 14 (App Router) · TypeScript estricto · Supabase · TanStack Query · PWA Offline-First.

Sistema visual **"Taller Nocturno"**: asfalto `#17181C` / hueso `#F7F5F0`, acento amarillo mototaxi `#FFC400`, alertas óxido `#C4472B`, WhatsApp `#25D366`.

---

## 1. Estructura de carpetas (Feature-based / Clean Architecture)

```
waly-motors-os/
├── public/
│   ├── manifest.json              # PWA: nombre, iconos, theme_color #FFC400
│   └── icons/                     # 192/512 maskable
├── supabase/
│   └── migrations/
│       └── 00001_esquema_inicial.sql
├── src/
│   ├── app/                       # Next.js App Router (solo enrutamiento)
│   │   ├── layout.tsx             # <AppShell> + <QueryClientProvider>
│   │   ├── (auth)/login/page.tsx
│   │   ├── dashboard/page.tsx     # → features/dashboard
│   │   ├── clientes/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── vehiculos/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   └── pagos/nuevo/page.tsx   # Registro Express 3 pasos
│   ├── components/
│   │   ├── layout/app-shell.tsx   # BottomNav + Sidebar responsivo
│   │   └── ui/                    # shadcn/ui (button, dialog, input…)
│   ├── features/                  # Lógica por dominio de negocio
│   │   ├── dashboard/
│   │   │   ├── dashboard.tsx      # KPIs + Acción Urgente + WhatsApp
│   │   │   └── components/
│   │   ├── clientes/
│   │   │   ├── hooks/use-clientes.ts
│   │   │   ├── components/
│   │   │   └── schemas.ts         # Zod: DNI 8 dígitos, RUC 11
│   │   ├── vehiculos/
│   │   ├── contratos/
│   │   └── pagos/
│   │       ├── hooks/use-registrar-pago.ts   # mutación optimista
│   │       └── components/registro-express/  # wizard 3 pasos
│   ├── lib/
│   │   ├── supabase.ts            # cliente browser + tipos + Intl es-PE
│   │   ├── supabase-server.ts     # cliente SSR (cookies)
│   │   └── utils.ts               # cn()
│   └── sw/
│       └── service-worker.ts      # Workbox: precache + runtime cache
├── next.config.mjs                # next-pwa / serwist
└── tailwind.config.ts
```

**Regla de dependencias:** `app/` solo enruta e importa de `features/`; `features/` importa de `lib/` y `components/ui/`; nunca al revés.

---

## 2. Instalación

```bash
pnpm create next-app@14 waly-motors-os --ts --tailwind --app --src-dir
cd waly-motors-os
pnpm add @supabase/supabase-js @supabase/ssr @tanstack/react-query framer-motion lucide-react zod
pnpm add -D @serwist/next serwist
npx shadcn@latest init
npx shadcn@latest add button dialog input textarea avatar badge
```

`.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

---

## 3. Base de datos

En el SQL Editor de Supabase, ejecutar **primero**:

```sql
create extension if not exists pg_trgm;
```

Luego correr `supabase/migrations/00001_esquema_inicial.sql`. Incluye:

- 5 tablas con `CHECK` de dominio peruano (DNI 8 dígitos, RUC 10/20 + 9, teléfono E.164).
- RLS: lectura para todo empleado autenticado, escritura solo `admin`/`asesor`, borrado solo `admin`.
- `fn_rol_actual()` `security definer` para evitar recursión de RLS.
- Trigger `updated_at` en todas las tablas.
- Índices en `clientes(numero_documento)`, `vehiculos(placa)`, `pagos(fecha_pago)` + trigram para autocompletado de nombres.
- **RPC `registrar_pago`**: atómica, con `SELECT ... FOR UPDATE` sobre el contrato (bloqueo pesimista contra cobros dobles en calle).
- **RPC `obtener_clientes_en_mora`**: calcula vencimiento según frecuencia (diario/semanal/quincenal/mensual) y último pago completado.
- **RPC `kpis_dashboard`**: caja del día, % flota alquilada, conteo en mora.

Storage: crear buckets `vehiculos`, `clientes`, `evidencias` (privados; lectura `authenticated`, escritura `admin`/`asesor` vía políticas de storage).

---

## 4. PWA Offline-First (Workbox / Serwist)

Estrategias recomendadas en `src/sw/service-worker.ts`:

| Recurso | Estrategia |
|---|---|
| App shell, JS/CSS | Precache (build) |
| `rpc/kpis_dashboard`, listas | `StaleWhileRevalidate` |
| Fotos (Storage) | `CacheFirst` con expiración 7 días |
| Mutaciones offline | `BackgroundSyncQueue` → reintenta `registrar_pago` al recuperar señal |

TanStack Query complementa con `networkMode: 'offlineFirst'` y persistencia en `localStorage` vía `@tanstack/react-query-persist-client`.

---

## 5. Entregado en este paquete

| Archivo | Contenido |
|---|---|
| `supabase/migrations/00001_esquema_inicial.sql` | Esquema completo + RLS + triggers + índices + 3 RPCs |
| `src/lib/supabase.ts` | Cliente, tipos de dominio, formateadores `es-PE` (S/.) |
| `src/components/layout/app-shell.tsx` | Bottom Nav móvil (botón flotante "Cobrar" en rombo) + Sidebar colapsable con indicador Realtime |
| `src/features/dashboard/dashboard.tsx` | KPI cards, lista de mora, modal WhatsApp con mensaje dinámico editable (`wa.me`) |
| `supabase/migrations/00002_buscar_contratos.sql` | RPC de autocompletado trgm (nombre/DNI/placa, morosos primero) |
| `src/features/pagos/hooks/use-registrar-pago.ts` | Subida a Storage + RPC atómica + cola offline con reintento al recuperar señal |
| `src/features/pagos/components/registro-express.tsx` | Wizard 3 pasos: búsqueda → monto/método → foto (cámara nativa) + confirmación |
| `supabase/migrations/00003_contratos.sql` | RPCs `crear_contrato` / `finalizar_contrato` (atómicas, FOR UPDATE en vehículo) + `resumen_contrato` + `vehiculos_disponibles` |
| `src/features/contratos/hooks/use-contratos.ts` | Queries de clientes/vehículos y mutaciones de contrato con invalidación de caché |
| `src/features/contratos/components/nuevo-contrato.tsx` | Wizard 4 pasos: cliente → vehículo → condiciones → confirmación con cuotas estimadas |
| `supabase/migrations/00004_storage.sql` | Buckets privados `vehiculos`/`clientes`/`evidencias` (5MB, solo imágenes) con políticas por rol |
| `src/features/vehiculos/**` | Listado con filtros de estado, taller (mantenimiento), formulario con galería multi-foto |
| `src/features/clientes/**` | Listado con búsqueda, formulario con validación DNI/RUC/celular +51 y foto de documento |
| `src/features/contratos/components/detalle-contrato.tsx` | Barra de progreso animada, historial de pagos con evidencias firmadas (lightbox), finalización con confirmación |
| `src/app/**` | App Router completo: layout, providers (Query persistido offline 24h), 12 rutas |
| `package.json`, `tailwind.config.ts`, `tsconfig.json`, `next.config.mjs` | Configuración lista para `pnpm install && pnpm dev` |
| `public/manifest.json` | PWA instalable (falta agregar iconos 192/512 en `public/icons/`) |
