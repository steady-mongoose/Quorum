import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  PublicGatheringLoading,
  PublicGatheringMissing,
  PublicGatheringView,
} from "@/components/board/public-gathering-view";
import { loadPublicGathering } from "@/lib/board/gathering-public";
import { publicGatheringMeta } from "@/lib/board/public-gathering";

export const Route = createFileRoute("/e/$id")({
  loader: async ({ params }) => {
    const gathering = await loadPublicGathering(params.id);
    if (!gathering) throw notFound();
    return gathering;
  },
  head: ({ loaderData, params }) => ({
    meta: publicGatheringMeta(loaderData ?? null, params.id),
    links: [{ rel: "stylesheet", href: "/gathering.css" }],
  }),
  pendingMs: 0,
  pendingComponent: PublicGatheringLoading,
  notFoundComponent: PublicGatheringMissing,
  component: PublicGatheringPage,
});

/** A public gathering. robots noindex. No sign-in. Anything unshared is not found. */
function PublicGatheringPage() {
  const gathering = Route.useLoaderData();
  if (!gathering) throw notFound();
  return <PublicGatheringView gathering={gathering} />;
}
