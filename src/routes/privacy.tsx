import { createFileRoute } from "@tanstack/react-router";
import { LegalNotice } from "@/components/board/legal-notice";
import { PublicDocument } from "@/components/board/public-document";
import { APP_NAME } from "@/lib/board/model";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: `Privacy · ${APP_NAME}` }] }),
  component: PrivacyPage,
});

/** Privacy, with no sign-in. The notice is not written yet. */
function PrivacyPage() {
  return (
    <PublicDocument page="/privacy" art="jerome">
      <LegalNotice title="Privacy" />
    </PublicDocument>
  );
}
