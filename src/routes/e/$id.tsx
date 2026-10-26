import { useEffect, useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicGatheringView } from "@/components/board/public-gathering-view";
import { loadPublicGathering, type PublicGathering } from "@/lib/board/gathering-public";

export const Route = createFileRoute("/e/$id")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex" },
      { title: "Gathering" },
    ],
  }),
  component: PublicGatheringPage,
});

/** A public gathering. No sign-in. Anything unshared is not found. */
function PublicGatheringPage() {
  const { id } = Route.useParams();
  const [gathering, setGathering] = useState<PublicGathering | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void loadPublicGathering(id).then((loaded) => {
      if (!live) return;
      setGathering(loaded);
    });
    return () => {
      live = false;
    };
  }, [id]);

  if (gathering === undefined) return <p className="px-6 py-8 text-muted">Loading.</p>;
  if (!gathering) throw notFound();
  return <PublicGatheringView gathering={gathering} />;
}
