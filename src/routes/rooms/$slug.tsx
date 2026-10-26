import { createFileRoute } from "@tanstack/react-router";
import { BoardApp } from "@/components/board/app";
import { categoryPreview } from "@/lib/board/categories";

export const Route = createFileRoute("/rooms/$slug")({
  head: ({ params }) => {
    const preview = categoryPreview(params.slug);
    return {
      meta: [
        { title: `${preview.title} · Avouch Social` },
        { name: "description", content: preview.description },
        { name: "robots", content: "noindex" },
        { property: "og:title", content: preview.title },
        { property: "og:description", content: preview.description },
        { property: "og:image", content: preview.image },
        { property: "og:image:alt", content: preview.credit },
      ],
    };
  },
  component: CategoryRoomsPage,
});

/** One category, members only. The address is the shareable page. */
function CategoryRoomsPage() {
  const { slug } = Route.useParams();
  return <BoardApp categorySlug={slug} />;
}
