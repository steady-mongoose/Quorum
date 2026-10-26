import { createFileRoute } from "@tanstack/react-router";
import { BoardApp } from "@/components/board/app";

export const Route = createFileRoute("/rooms/")({
  head: () => ({
    meta: [{ title: "Rooms · Avouch Social" }, { name: "robots", content: "noindex" }],
  }),
  component: RoomsPage,
});

/** Members only. Signed-out visitors see the door, not the rooms. */
function RoomsPage() {
  return <BoardApp categorySlug={null} />;
}
