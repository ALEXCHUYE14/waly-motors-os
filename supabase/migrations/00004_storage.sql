-- ============================================================
-- WALY MOTORS OS — Migración 00004
-- Buckets de Storage privados + políticas de acceso
--   vehiculos  → galería de fotos de mototaxis
--   clientes   → foto de perfil / documento (DNI)
--   evidencias → comprobantes de pago (Yape/Plin/voucher)
-- Lectura: empleados autenticados. Escritura: admin/asesor.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('vehiculos',  'vehiculos',  false, 5242880, array['image/jpeg','image/png','image/webp']),
  ('clientes',   'clientes',   false, 5242880, array['image/jpeg','image/png','image/webp']),
  ('evidencias', 'evidencias', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Lectura para todo empleado autenticado
create policy "storage_select_empleados"
  on storage.objects for select to authenticated
  using (bucket_id in ('vehiculos', 'clientes', 'evidencias'));

-- Escritura solo admin/asesor
create policy "storage_insert_gestion"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('vehiculos', 'clientes', 'evidencias')
    and public.fn_rol_actual() in ('admin', 'asesor')
  );

create policy "storage_update_gestion"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('vehiculos', 'clientes', 'evidencias')
    and public.fn_rol_actual() in ('admin', 'asesor')
  );

create policy "storage_delete_admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('vehiculos', 'clientes', 'evidencias')
    and public.fn_rol_actual() = 'admin'
  );
