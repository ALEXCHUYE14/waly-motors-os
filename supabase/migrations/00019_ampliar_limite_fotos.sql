-- ============================================================
-- WALY MOTORS OS — Migración 00019
--
-- Bug real reportado: al tomar/subir una foto desde la cámara de un
-- celular o tablet (registro de cliente o de mototaxi), el peso del
-- archivo a veces impedía la subida. Causa: los buckets `vehiculos`,
-- `clientes` y `evidencias` tenían un límite de 5 MB por archivo, y
-- `contratos`/`garantias` de 10 MB — las cámaras de teléfonos modernos
-- pueden producir fotos de 10-20 MB en alta resolución, superando esos
-- límites.
--
-- El arreglo principal (comprimir la foto antes de subirla, a ~1920px
-- de lado y calidad JPEG 0.82) va en el frontend — ver `comprimirImagen`
-- en `src/lib/utils.ts`, aplicado en los 4 puntos donde una foto de
-- cámara entra al sistema (cliente, vehículo, garantía de contrato,
-- evidencia de cobro). Esta migración es la red de seguridad del lado
-- del servidor: si la compresión no puede correr (formato que el
-- navegador no decodifica, etc.) el archivo original igual debe poder
-- subirse. Se sube el límite a 25 MB en todos los buckets de fotos —
-- muy por encima de cualquier foto de cámara real — y se agregan los
-- tipos HEIC/HEIF (formato nativo de fotos de iPhone) a los buckets que
-- reciben fotos directamente del usuario, por si el navegador entrega el
-- archivo sin transcodificar a JPEG.
-- ============================================================

update storage.buckets
set file_size_limit = 26214400 -- 25 MB
where id in ('vehiculos', 'clientes', 'evidencias', 'contratos', 'garantias');

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id in ('vehiculos', 'clientes', 'evidencias');

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
where id = 'garantias';
