import { useEffect, useRef, useState } from "react";
import { btnGhost, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  deactivateAccount,
  loadDeletionRequests,
  reactivateAccount,
  readAccount,
  requestAccountDeletion,
  type DeletionRequest,
} from "@/lib/board/account-api";
import { DELETION_REQUESTS_WAIT } from "@/lib/board/load-failure";
import { HEADING_FOCUS_RING, PanelNote, usePanelRetry } from "@/components/board/panel-note";

export function AccountRemovalPanel({
  deactivated,
  deletionRequested,
  note,
  error,
  pending,
  onNote,
  onDeactivate,
  onReactivate,
  onRequest,
}: {
  deactivated: boolean;
  deletionRequested: boolean;
  note: string;
  error: string;
  pending: boolean;
  onNote: (note: string) => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onRequest: () => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-2xl text-fg">Account</h2>
      <p className="max-w-prose text-sm text-muted">
        Deactivation hides your profile and posts. You can turn it back on.
      </p>
      {deactivated ? (
        <p className="text-sm text-fg">Your profile and posts are hidden.</p>
      ) : null}
      {deactivated ? (
        <button type="button" className={cn(btnGhost, "self-start")} aria-disabled={pending || undefined} onClick={() => !pending && onReactivate()}>
          Reactivate account
        </button>
      ) : (
        <button type="button" className={cn(btnGhost, "self-start")} aria-disabled={pending || undefined} onClick={() => !pending && onDeactivate()}>
          Deactivate account
        </button>
      )}
      <p className="max-w-prose text-sm text-muted">
        A deletion request is queued for an admin and written to the audit log. It does not delete
        the account now.
      </p>
      <label className="flex max-w-prose flex-col gap-2 text-sm text-muted">
        Note for the admin, optional
        <textarea
          className={cn(fieldClass, "min-h-20")}
          maxLength={500}
          value={note}
          onChange={(event) => onNote(event.target.value)}
        />
      </label>
      <button
        type="button"
        className={cn(btnGhost, "self-start")}
        aria-disabled={pending || deletionRequested || undefined}
        onClick={() => !(pending || deletionRequested) && onRequest()}
      >
        Request account deletion
      </button>
      {deletionRequested ? (
        <p role="status" className="text-sm text-muted">
          Deletion requested. An admin has it in the queue.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function AccountRemoval({ live }: { live: boolean }) {
  const [deactivated, setDeactivated] = useState(false);
  const [deletionRequested, setDeletionRequested] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!live) return;
    let cancel = false;
    void readAccount().then((result) => {
      if (cancel || !result.ok) return;
      setDeactivated(result.value.deactivated);
      setDeletionRequested(result.value.deletionRequested);
    });
    return () => {
      cancel = true;
    };
  }, [live]);

  if (!live) return null;

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, after: () => void) {
    setPending(true);
    setError("");
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    after();
  }

  return (
    <AccountRemovalPanel
      deactivated={deactivated}
      deletionRequested={deletionRequested}
      note={note}
      error={error}
      pending={pending}
      onNote={setNote}
      onDeactivate={() => {
        void run(deactivateAccount, () => setDeactivated(true));
      }}
      onReactivate={() => {
        void run(reactivateAccount, () => setDeactivated(false));
      }}
      onRequest={() => {
        void run(
          () => requestAccountDeletion(note),
          () => setDeletionRequested(true),
        );
      }}
    />
  );
}

export function DeletionRequestQueue({ onSetUp }: { onSetUp?: () => void } = {}) {
  const [requests, setRequests] = useState<DeletionRequest[] | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { tick, failure, retry, loaded, failed } = usePanelRetry(heading);

  useEffect(() => {
    let cancel = false;
    void loadDeletionRequests().then((result) => {
      if (cancel) return;
      // A failed load is said inside this panel, never as a page alert.
      if (!result.ok) {
        failed(result);
        return;
      }
      setRequests(result.requests);
      loaded();
    });
    return () => {
      cancel = true;
    };
  }, [tick]);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 ref={heading} tabIndex={-1} className={`text-2xl text-fg ${HEADING_FOCUS_RING}`}>
        Account deletion requests
      </h2>
      <p className="max-w-prose text-sm text-muted">
        A member asked for the account to be deleted. This list does not delete it.
      </p>
      <PanelNote
        failure={failure}
        gateText={DELETION_REQUESTS_WAIT}
        onRetry={retry}
        onSetUp={onSetUp}
      />
      {requests && requests.length === 0 ? (
        <p className="text-sm text-muted">No open deletion requests.</p>
      ) : null}
      {requests && requests.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {requests.map((request) => (
            <li key={request.id} className="rounded-md border border-line px-3 py-2 text-sm text-muted">
              <span className="text-fg">{request.name}</span>
              {" · "}
              {new Date(request.at).toLocaleString()}
              {request.note ? ` · ${request.note}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
