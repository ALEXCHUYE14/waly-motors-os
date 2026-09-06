-- ============================================================
-- WALY MOTORS OS — Migración 00024
--
-- Compatibilidad histórica de la Sección III del PDF: quitar el
-- "Monto total" de la tabla de esa sección (ya hecho en el código,
-- `src/lib/contrato-pdf.ts`) solo corrige los PDF que se generen DE
-- AHORA EN ADELANTE — un contrato ya registrado, con `contrato_pdf_url`
-- apuntando a un archivo YA GENERADO en Storage, seguiría sirviendo esa
-- versión vieja (con el monto total visible) para siempre, porque el
-- sistema solo genera el PDF una vez y lo cachea (`asegurarRutaContratoPdf`
-- en detalle-contrato.tsx).
--
-- Esta migración limpia el puntero cacheado (`contrato_pdf_url = null`)
-- de TODOS los contratos que ya tengan uno — la próxima vez que alguien
-- pida "Descargar" o "Enviar por WhatsApp" ese contrato, el mecanismo
-- "on-demand" que ya existe lo regenera solo, ya con la Sección III
-- corregida. NO se toca ninguna otra columna: `monto_total` (el dato
-- real en la base) queda exactamente igual que antes — el pedido fue
-- ocultar la VISUALIZACIÓN, nunca borrar o alterar el campo almacenado.
-- Los archivos PDF viejos quedan huérfanos en el bucket `contratos`
-- (Postgres no puede tocar Storage); son inofensivos y de bajo costo,
-- se limpian solos con el flujo normal de "eliminar contrato" cuando
-- ese contrato se finalice y borre más adelante.
-- ============================================================

update public.contratos
set contrato_pdf_url = null
where contrato_pdf_url is not null;
