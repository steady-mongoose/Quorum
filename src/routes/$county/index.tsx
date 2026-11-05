import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { isCountyId } from "@/lib/board/counties";

export const Route = createFileRoute("/$county/")({
  beforeLoad: ({ params }) => {
    if (!isCountyId(params.county)) throw notFound();
    throw redirect({ to: "/$county/rooms", params: { county: params.county } });
  },
});
