import { createFileRoute } from "@tanstack/react-router";
import { AboutView } from "@/components/board/about-view";
import { PublicDocument } from "@/components/board/public-document";
import { APP_NAME } from "@/lib/board/model";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: `About · ${APP_NAME}` }] }),
  component: AboutPage,
});

/** About, with no sign-in. The member account section stays on the board. */
function AboutPage() {
  return (
    <PublicDocument page="/about" wide>
      <AboutView publicView />
    </PublicDocument>
  );
}
