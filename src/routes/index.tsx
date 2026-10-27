import { createFileRoute } from "@tanstack/react-router";
import { BoardApp } from "@/components/board/app";
import { homeMeta } from "@/lib/board/route-heads";

export const Route = createFileRoute("/")({
  head: () => ({ meta: homeMeta() }),
  component: Home,
});

function Home() {
  return <BoardApp />;
}
