import { FormularioVehiculo } from "@/features/vehiculos/components/vehiculos";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FormularioVehiculo id={id} />;
}
