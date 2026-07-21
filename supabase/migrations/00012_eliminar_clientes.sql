-- ============================================================
-- WALY MOTORS OS — Migración 00012
-- Elimina clientes de forma segura, sin romper el historial de
-- contratos ya finalizados:
--   · `contratos.cliente_id` referencia a `clientes(id)` sin
--     ON DELETE CASCADE — un DELETE físico fallaría por la llave
--     foránea en CUALQUIER cliente con historial de contratos,
--     incluso si todos están finalizados. Por eso "eliminar" es un
--     soft delete: se agrega la columna `activo` y la fila nunca se
--     borra de verdad.
--   · eliminar_cliente(): RPC atómica que bloquea la eliminación si
--     el cliente tiene algún contrato vigente (no finalizado); si no
--     tiene ninguno, marca `activo = false` en vez de borrar la fila.
--   · Los listados de clientes filtran `activo = true` en el
--     frontend (ver useClientes en features/clientes/components/clientes.tsx).
-- ============================================================

alter table public.clientes
  add column activo boolean not null default true;

create index idx_clientes_activo on public.clientes (activo);

create or replace function public.eliminar_cliente(p_cliente_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.fn_rol_actual() <> 'admin' then
    raise exception 'Solo un administrador puede eliminar clientes';
  end if;

  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'Cliente no encontrado';
  end if;

  if exists (
    select 1 from public.contratos
    where cliente_id = p_cliente_id and estado <> 'finalizado'
  ) then
    raise exception 'No se puede eliminar: el cliente tiene un contrato vigente sin finalizar';
  end if;

  update public.clientes set activo = false where id = p_cliente_id;
end;
$$;
