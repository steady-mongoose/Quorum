import { createFileRoute } from "@tanstack/react-router";
import { TakedownPage } from "@/components/takedown/takedown-page";

export const Route = createFileRoute("/takedown")({
  head: () => ({ meta: [{ title: "Request removal of intimate images · Avouch" }] }),
  component: () => <TakedownPage />,
});
