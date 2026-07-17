import { FormularioCliente } from "@/features/clientes/components/clientes";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FormularioCliente id={id} />;
}
