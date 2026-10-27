import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import {
  COMPLETE_DELETION_BODY,
  COMPLETE_DELETION_CANCEL,
  COMPLETE_DELETION_CONFIRM,
  DELETION_REQUEST_COPY,
  completeDeletionDone,
  completeDeletionTitle,
} from "@/lib/board/account-copy";
import { btnGhost, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  completeDeletionRequest,
  deactivateAccount,
  loadDeletionRequests,
  reactivateAccount,
  readAccount,
  requestAccountDeletion,
  type DeletionRequest,
} from "@/lib/board/account-api";

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
      {deactivated ? <p className="text-sm text-fg">Your profile and posts are hidden.</p> : null}
      {deactivated ? (
        <button type="button" className={cn(btnGhost, "self-start")} aria-disabled={pending || undefined} onClick={() => !pending && onReactivate()}>
          Reactivate account
        </button>
      ) : (
        <button type="button" className={cn(btnGhost, "self-start")} aria-disabled={pending || undefined} onClick={() => !pending && onDeactivate()}>
          Deactivate account
        </button>
      )}
      <p className="max-w-prose text-sm text-muted">{DELETION_REQUEST_COPY}</p>
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

  async function run(
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    after: () => void,
  ) {
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

export function DeletionRequestQueue({
  load = loadDeletionRequests,
  complete = completeDeletionRequest,
}: {
  load?: typeof loadDeletionRequests;
  complete?: typeof completeDeletionRequest;
} = {}) {
  const [requests, setRequests] = useState<DeletionRequest[] | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<DeletionRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [focusTick, setFocusTick] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusTick) return;
    const timer = setTimeout(() => heading.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [focusTick]);

  const confirm = () => {
    const request = pending;
    if (!request || busy) return;
    setBusy(true);
    setDone("");
    void complete(request.id).then((result) => {
      setBusy(false);
      setPending(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError("");
      setRequests((current) => (current ?? []).filter((item) => item.id !== request.id));
      setDone(completeDeletionDone(result.erased, result.kept));
      setFocusTick((n) => n + 1);
    });
  };

  useEffect(() => {
    let cancel = false;
    void load().then((result) => {
      if (cancel) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRequests(result.requests);
    });
    return () => {
      cancel = true;
    };
  }, [load]);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 ref={heading} tabIndex={-1} className="text-2xl text-fg">
        Account deletion requests
      </h2>
      <p className="max-w-prose text-sm text-muted">
        A member asked for their account to be deleted. Completing a request erases that member's posts, with their photos and videos, and closes the account. Posts under a hold, an open report, or a pending appeal are kept, with their files, until that is finished.
      </p>
      <p role="status" className="text-sm text-muted">
        {done}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {requests && requests.length === 0 ? (
        <p className="text-sm text-muted">No open deletion requests.</p>
      ) : null}
      {requests && requests.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {requests.map((request) => (
            <li
              key={request.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-muted"
            >
              <span>
                <span className="text-fg">{request.name}</span>
                {" · "}
                {new Date(request.at).toLocaleString()}
                {request.note ? ` · ${request.note}` : ""}
              </span>
              <button
                type="button"
                className={cn(btnGhost, "min-h-[44px]")}
                aria-label={`Complete ${request.name}'s deletion request`}
                aria-disabled={busy || undefined}
                onClick={() => !busy && setPending(request)}
              >
                Complete
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ConfirmDialog
        open={pending !== null}
        title={pending ? completeDeletionTitle(pending.name) : ""}
        description={COMPLETE_DELETION_BODY}
        confirmLabel={COMPLETE_DELETION_CONFIRM}
        cancelLabel={COMPLETE_DELETION_CANCEL}
        tone="danger"
        cancelFirst
        confirmDisabled={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
