import { createFileRoute } from "@tanstack/react-router";
import { BoardApp } from "@/components/board/app";
import { homeMeta } from "@/lib/board/route-heads";

export const Route = createFileRoute("/you")({
  head: () => ({ meta: homeMeta() }),
  component: YouPage,
});

/** Members only. The authenticator sits on this page. */
function YouPage() {
  return <BoardApp initialSection="profile" />;
}
