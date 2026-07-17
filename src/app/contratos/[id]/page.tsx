import DetalleContrato from "@/features/contratos/components/detalle-contrato";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetalleContrato contratoId={id} />;
}
