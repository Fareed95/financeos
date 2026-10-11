import { createFileRoute } from "@tanstack/react-router";
import { useAppData } from "@/components/data-provider";
import { FamilyWorkspace } from "@/components/finance/family-workspace";

export const Route = createFileRoute("/_app/family/$familyId")({ component: FamilyPage });

function FamilyPage() {
  const { familyId } = Route.useParams();
  const { currency } = useAppData();
  return <FamilyWorkspace familyId={familyId} currency={currency} />;
}
