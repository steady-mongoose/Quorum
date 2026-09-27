import { createFileRoute } from "@tanstack/react-router";
import { QuorumApp } from "@/components/quorum/app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <QuorumApp />;
}
