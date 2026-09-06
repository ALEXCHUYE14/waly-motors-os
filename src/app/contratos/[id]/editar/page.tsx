import EditarContrato from "@/features/contratos/components/editar-contrato";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditarContrato contratoId={id} />;
}
