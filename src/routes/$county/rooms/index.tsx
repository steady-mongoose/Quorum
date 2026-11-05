import { createFileRoute, notFound } from "@tanstack/react-router";
import { BoardApp } from "@/components/board/app";
import { isCountyId } from "@/lib/board/counties";
import { countyRoomsMeta } from "@/lib/board/route-heads";

export const Route = createFileRoute("/$county/rooms/")({
  beforeLoad: ({ params }) => {
    if (!isCountyId(params.county)) throw notFound();
  },
  head: ({ params }) => ({ meta: countyRoomsMeta(params.county) }),
  component: CountyRoomsPage,
});

/** One county's rooms, members only. Signed-out visitors see the door. */
function CountyRoomsPage() {
  const { county } = Route.useParams();
  return <BoardApp categorySlug={null} county={county} />;
}
