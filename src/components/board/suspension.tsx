import { useCallback, useEffect, useId, useRef, useState } from "react";
import { btnGhost, btnSignal, fieldClass } from "@/components/quorum/bits";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { cn } from "@/lib/cn";
import { RULE_LABEL, type HardRule } from "@/lib/board/model";
import {
  suspensionApi,
  type BanReviewView,
  type OwnSuspension,
  type SuspensionApi,
} from "@/lib/board/suspension-api";

export const SUSPENDED_TITLE = "Your account is suspended";
export const APPEAL_INTRO =
  "If you think this is a mistake, you can appeal. An admin who did not take part reads every appeal.";
export const PORN_APPEAL_LINE =
  "A pornography removal can be appealed only if your account was taken over by someone else.";
export const CSAM_NO_APPEAL = "This removal can't be appealed.";
export const CHAT_APPEAL_LINE = "To appeal a chat removal, write to safety@avouchsocial.com.";
export const APPEAL_SENT = "Appeal sent. An admin will read it.";
export const ACCOUNT_CLOSED = "Account closed.";
export const SUSPENSION_LIFTED = "Suspension lifted.";
export const OWN_CASE = "Another admin decides your own case.";
export const COMPROMISE_MIN = 200;

/** Lowercases only the first letter, so God's name keeps its capital. */
function ruleText(reason: string): string {
  const label = RULE_LABEL[reason as HardRule] ?? reason;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

export function suspendedExplanation(reason: string, chat: boolean): string {
  return `A steward removed one of your ${chat ? "chat messages" : "posts"} under the rule on ${ruleText(reason)}. Because of that rule, your account is suspended everywhere on Avouch while an admin reviews it. You can't post, chat or join calls until the review is done.`;
}

export const closeConfirm = (name: string) =>
  `Close ${name}'s account for good? They can't sign in again. They can appeal to another admin.`;
export const clearConfirm = (name: string) =>
  `Lift ${name}'s suspension? Their account works again. The removed post stays removed.`;

/** A full-page notice in place of the board while a steward's suspension waits on an admin. */
export function SuspendedNotice({
  suspension,
  api = suspensionApi,
}: {
  suspension: Extract<OwnSuspension, { suspended: true }>;
  api?: SuspensionApi;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const ids = useId();
  const porn = suspension.reason === "porn";
  const csam = suspension.reason === "csam";
  const chat = !suspension.postId;

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const send = async () => {
    if (busy || !suspension.postId) return;
    const why = reason.trim();
    const proof = evidence.trim();
    if (!why) {
      setError("Say in one sentence why this is a mistake.");
      return;
    }
    if (porn && proof.length < COMPROMISE_MIN) {
      setError(`Show how your account was taken over: what happened, when, and the proof, in at least ${COMPROMISE_MIN} characters.`);
      return;
    }
    setBusy(true);
    const done = await api.appeal(suspension.postId, why, proof, porn);
    setBusy(false);
    if (!done.ok) setError(done.error);
    else {
      setSent(true);
      setOpen(false);
    }
  };

  return (
    <div role="status" className="mx-auto flex w-full max-w-prose flex-col gap-3 rounded-lg border border-line bg-surface p-5 text-fg">
      <h1 ref={heading} tabIndex={-1} className="text-3xl text-fg">
        {SUSPENDED_TITLE}
      </h1>
      <p>{suspendedExplanation(suspension.reason, chat)}</p>
      {csam ? (
        <p>{CSAM_NO_APPEAL}</p>
      ) : chat ? (
        <p>{CHAT_APPEAL_LINE}</p>
      ) : sent ? (
        <p>{APPEAL_SENT}</p>
      ) : (
        <>
          <p>{APPEAL_INTRO}</p>
          {porn ? <p>{PORN_APPEAL_LINE}</p> : null}
          {open ? (
            <div className="flex flex-col gap-3">
              <label htmlFor={`${ids}-why`} className="flex flex-col gap-1">
                Why this is a mistake, in one sentence (required)
                <textarea
                  id={`${ids}-why`}
                  className={cn(fieldClass, "min-h-[44px]")}
                  aria-required="true"
                  maxLength={500}
                  value={reason}
                  aria-describedby={error ? `${ids}-error` : undefined}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setError("");
                  }}
                />
              </label>
              {porn ? (
                <label htmlFor={`${ids}-proof`} className="flex flex-col gap-1">
                  How your account was taken over: what happened, when, and the proof (required)
                  <textarea
                    id={`${ids}-proof`}
                    className={cn(fieldClass, "min-h-24")}
                    aria-required="true"
                    maxLength={4000}
                    value={evidence}
                    aria-describedby={error ? `${ids}-error` : undefined}
                    onChange={(event) => {
                      setEvidence(event.target.value);
                      setError("");
                    }}
                  />
                </label>
              ) : null}
              <button
                type="button"
                className={cn(btnSignal, "self-start min-h-[44px]")}
                aria-disabled={busy || undefined}
                onClick={() => void send()}
              >
                Send appeal
              </button>
            </div>
          ) : (
            <button type="button" className={cn(btnSignal, "self-start min-h-[44px]")} onClick={() => setOpen(true)}>
              Appeal
            </button>
          )}
        </>
      )}
      {error ? (
        <p id={`${ids}-error`} role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Admin only. Members a steward suspended, waiting on an admin to close the account or clear them. */
export function BanReviewQueue({ api = suspensionApi }: { api?: SuspensionApi }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [reviews, setReviews] = useState<BanReviewView[]>([]);
  const [error, setError] = useState("");
  const [announce, setAnnounce] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ review: BanReviewView; decision: "closed" | "cleared" } | null>(null);
  const [focusHeading, setFocusHeading] = useState(0);

  const load = useCallback(async () => {
    const next = await api.reviews();
    if ("error" in next) setError(next.error);
    else {
      setReviews(next.reviews);
      setError("");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!focusHeading) return;
    const timer = setTimeout(() => heading.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [focusHeading]);

  const decide = async () => {
    if (!pending || busy) return;
    const { review, decision } = pending;
    setBusy(true);
    try {
      const done = await api.decide(review.id, decision);
      if (!done.ok) setError(done.error);
      else {
        await load();
        setAnnounce(decision === "closed" ? ACCOUNT_CLOSED : SUSPENSION_LIFTED);
      }
    } finally {
      setBusy(false);
      setPending(null);
      setFocusHeading((n) => n + 1);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 id="ban-review-heading" ref={heading} tabIndex={-1} className="text-2xl text-fg">
        Suspensions to review
      </h2>
      <p className="max-w-prose text-sm text-muted">
        A steward's removal for pornography, child sexual abuse material or a second strike suspends the
        member everywhere on Avouch. An admin closes the account for good or clears them. A child sexual
        abuse material suspension can't be cleared.
      </p>
      <p className="sr-only" role="status">
        {announce}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {reviews.length === 0 ? (
        <p className="text-sm text-muted">No suspensions to review.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => (
            <li key={review.id} className="flex flex-col gap-2 rounded-md border border-line px-3 py-2 text-sm">
              <p className="text-fg">
                {review.name || "A member"}: {RULE_LABEL[review.reason as HardRule] ?? review.reason}
              </p>
              <p className="text-muted">
                Suspended {new Date(review.at).toLocaleString()} by {review.requestedBy || "a steward"}, steward of{" "}
                {review.roomId || "a room"}.
              </p>
              {review.own ? (
                <p className="text-muted">{OWN_CASE}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={cn(btnGhost, "min-h-[44px]")}
                    aria-label={`Close account for ${review.name || "this member"}`}
                    aria-disabled={busy || undefined}
                    onClick={() => !busy && setPending({ review, decision: "closed" })}
                  >
                    Close account
                  </button>
                  {review.reason !== "csam" ? (
                    <button
                      type="button"
                      className={cn(btnGhost, "min-h-[44px]")}
                      aria-label={`Clear and restore ${review.name || "this member"}`}
                      aria-disabled={busy || undefined}
                      onClick={() => !busy && setPending({ review, decision: "cleared" })}
                    >
                      Clear and restore
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {pending ? (
        <ConfirmDialog
          open
          title={pending.decision === "closed" ? "Close account" : "Clear and restore"}
          description={
            pending.decision === "closed"
              ? closeConfirm(pending.review.name || "this member")
              : clearConfirm(pending.review.name || "this member")
          }
          confirmLabel={pending.decision === "closed" ? "Close account" : "Clear and restore"}
          cancelLabel="Cancel"
          tone={pending.decision === "closed" ? "danger" : "neutral"}
          onCancel={() => setPending(null)}
          onConfirm={() => void decide()}
        />
      ) : null}
    </section>
  );
}
