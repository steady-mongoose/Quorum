import { createFileRoute } from "@tanstack/react-router";
import { BoardApp } from "@/components/board/app";
import { homeMeta } from "@/lib/board/route-heads";

export const Route = createFileRoute("/find")({
  head: () => ({ meta: homeMeta() }),
  component: FindPage,
});

/** Members only. Signed-out visitors see the door. */
function FindPage() {
  return <BoardApp initialSection="find" />;
}
