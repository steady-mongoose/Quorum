import { createFileRoute } from "@tanstack/react-router";
import { LegalNotice } from "@/components/board/legal-notice";
import { PublicDocument } from "@/components/board/public-document";
import { APP_NAME } from "@/lib/board/model";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: `Terms · ${APP_NAME}` }] }),
  component: TermsPage,
});

/** Terms, with no sign-in. The notice is not written yet. */
function TermsPage() {
  return (
    <PublicDocument page="/terms" art="jerome">
      <LegalNotice title="Terms" />
    </PublicDocument>
  );
}
