import { createFileRoute } from "@tanstack/react-router";
import { AssistantChat } from "@/components/finance/assistant-chat";

export const Route = createFileRoute("/_app/assistant")({
  component: AssistantPage,
});

function AssistantPage() {
  return <AssistantChat />;
}
