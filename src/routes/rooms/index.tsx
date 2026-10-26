import { createFileRoute } from "@tanstack/react-router";
import { BoardApp } from "@/components/board/app";
import { roomsIndexMeta } from "@/lib/board/route-heads";

export const Route = createFileRoute("/rooms/")({
  head: () => ({ meta: roomsIndexMeta() }),
  component: RoomsPage,
});

/** Members only. Signed-out visitors see the door, not the rooms. */
function RoomsPage() {
  return <BoardApp categorySlug={null} />;
}
