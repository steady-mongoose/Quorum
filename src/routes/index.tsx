import { createFileRoute } from "@tanstack/react-router";
import { BoardApp } from "@/components/board/app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <BoardApp />;
}
