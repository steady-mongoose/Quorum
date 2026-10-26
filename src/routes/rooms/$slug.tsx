import { createFileRoute } from "@tanstack/react-router";
import { BoardApp } from "@/components/board/app";

export const Route = createFileRoute("/rooms/$slug")({
  head: () => ({
    meta: [{ title: "Rooms · Avouch Social" }, { name: "robots", content: "noindex" }],
  }),
  component: CategoryRoomsPage,
});

/** One category, members only. The address is the shareable page. */
function CategoryRoomsPage() {
  const { slug } = Route.useParams();
  return <BoardApp categorySlug={slug} />;
}
