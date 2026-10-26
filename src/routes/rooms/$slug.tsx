import { createFileRoute } from "@tanstack/react-router";
import { BoardApp } from "@/components/board/app";
import { categoryPageMeta } from "@/lib/board/route-heads";

export const Route = createFileRoute("/rooms/$slug")({
  head: ({ params }) => ({ meta: categoryPageMeta(params.slug) }),
  component: CategoryRoomsPage,
});

/** One category, members only. The address is the shareable page. */
function CategoryRoomsPage() {
  const { slug } = Route.useParams();
  return <BoardApp categorySlug={slug} />;
}
