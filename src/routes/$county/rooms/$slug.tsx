import { createFileRoute, notFound } from "@tanstack/react-router";
import { BoardApp } from "@/components/board/app";
import { isCountyId } from "@/lib/board/counties";
import { countyCategoryMeta } from "@/lib/board/route-heads";

export const Route = createFileRoute("/$county/rooms/$slug")({
  beforeLoad: ({ params }) => {
    if (!isCountyId(params.county)) throw notFound();
  },
  head: ({ params }) => ({ meta: countyCategoryMeta(params.county, params.slug) }),
  component: CountyCategoryPage,
});

/** One category in one county, members only. The address is the shareable page. */
function CountyCategoryPage() {
  const { county, slug } = Route.useParams();
  return <BoardApp categorySlug={slug} county={county} />;
}
