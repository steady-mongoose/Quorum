import { useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { btnGhost, btnSignal, fieldClass } from "@/components/quorum/bits";
import { apiFetch } from "@/lib/api-base";
import { cn } from "@/lib/cn";
import {
  CLAIM_ALLOWED_METHODS,
  CLAIM_METHOD_HINT,
  CLAIM_METHOD_LABEL,
  type ClaimMethod,
} from "@/lib/board/claim-policy";
import { useBoard } from "@/lib/board/store";
import { userFacingError } from "@/lib/board/errors";

/** A request that never reached the server (softenFetch's 503 "api-unavailable", or no JSON body). */
export const CLAIM_NOT_SENT = "Your request did not send. Try again in a moment.";

/** Plain words for a failed claim request: never a bare code like "api-unavailable". */
export function claimError(json: { error?: string } | null, fallback: string): string {
  if (!json || json.error === "api-unavailable") return CLAIM_NOT_SENT;
  return userFacingError(json.error ?? "", fallback);
}

type ClaimRow = {
  id: string;
  roomId: string;
  name: string;
  town: string;
  county: string;
  category: string;
  sourceUrl: string;
  method: string;
  state: string;
  claimantName: string;
  verified: boolean;
  token: string;
  email: string;
  createdAt: number;
  decidedAt: number | null;
  mine: boolean;
};

type ListingRow = {
  id: string;
  name: string;
  town: string;
  county: string;
  category: string;
  sourceUrl: string;
  status: string;
};

type Queue = {
  methods: string[];
  claims: ClaimRow[];
  log: ClaimRow[];
  listings: ListingRow[];
};

const DECIDED_LABEL: Record<string, string> = {
  approved: "Now hosted",
  rejected: "Turned down",
  expired: "Lapsed",
};

function isMethod(value: string): value is ClaimMethod {
  return value === "site_code" || value === "domain_email" || value === "steward_review";
}

function placeLine(row: { town: string; county: string; category: string }): string {
  return [row.town, row.county, row.category].filter(Boolean).join(", ");
}

function when(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString();
}

async function readQueue(): Promise<{ ok: true; queue: Queue } | { ok: false; error: string }> {
  const response = await apiFetch("/api/claims", { credentials: "include" });
  const json = (await response.json().catch(() => null)) as (Queue & { error?: string }) | null;
  if (!response.ok || !json || !Array.isArray(json.claims)) {
    return {
      ok: false,
      error: userFacingError(json?.error ?? "", "The claims queue is not available yet."),
    };
  }
  return {
    ok: true,
    queue: {
      methods: Array.isArray(json.methods)
        ? json.methods.filter((item) => typeof item === "string")
        : [],
      claims: json.claims,
      log: Array.isArray(json.log) ? json.log : [],
      listings: Array.isArray(json.listings) ? json.listings : [],
    },
  };
}

/**
 * Claims in the order they were opened. Listings in the order they were
 * seeded. Nothing here is ranked.
 */
export function ClaimsPanel({ onNotListed }: { onNotListed?: () => void } = {}) {
  const steward = useBoard((state) => state.steward);
  const admin = useBoard((state) => state.admin);
  const stewardRooms = useBoard((state) => state.stewardRooms);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [errorWhere, setErrorWhere] = useState<"queue" | "form" | "">("");
  // A queue that fails to load is a quiet status, not an alert: nobody submitted anything (Design #123 Low 4).
  const [loadError, setLoadError] = useState("");
  const [roomId, setRoomId] = useState("");
  const [filter, setFilter] = useState("");
  const [method, setMethod] = useState<string>(CLAIM_ALLOWED_METHODS[0] ?? "site_code");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [issued, setIssued] = useState("");
  const [pending, setPending] = useState<ClaimRow | null>(null);
  const [pendingKind, setPendingKind] = useState<"approve" | "reject">("reject");
  // One claim POST at a time: a double click or Enter plus a click sends once (QA #123).
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const listingRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);
  const queueHead = useRef<HTMLHeadingElement>(null);
  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const focusAfter = useRef<string | null>(null);
  const proofId = useId();

  async function reload() {
    const loaded = await readQueue();
    if (!loaded.ok) {
      setLoadError(loaded.error);
      return;
    }
    setLoadError("");
    setError("");
    setErrorWhere("");
    setQueue(loaded.queue);
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (focusAfter.current === null) return;
    const next = focusAfter.current;
    focusAfter.current = null;
    const heading = next ? headings.current.get(next) : null;
    if (heading) heading.focus();
    else if (emptyRef.current) emptyRef.current.focus();
    else queueHead.current?.focus();
  }, [queue]);

  const methods = (queue?.methods.length ? queue.methods : [...CLAIM_ALLOWED_METHODS]).filter(
    isMethod,
  );
  const chosen = methods.includes(method as ClaimMethod) ? method : methods[0];
  const canDecide = steward || admin;
  const choices = (queue?.listings ?? []).filter((row) => row.status === "unclaimed");
  const picked = choices.find((row) => row.id === roomId) ?? null;

  function canReview(row: ClaimRow): boolean {
    return !row.mine && (admin || stewardRooms.includes(row.roomId));
  }

  function showError(where: "queue" | "form", message: string) {
    setNotice("");
    setError(message);
    setErrorWhere(where);
    queueMicrotask(() => errorRef.current?.focus());
  }

  async function settle(kind: "approve" | "reject", row: ClaimRow) {
    setPending(null);
    const response = await apiFetch(`/api/claims/${row.id}/decide`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: kind === "approve" ? "approve" : "reject" }),
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      showError("queue", claimError(json, "That claim was not decided."));
      return;
    }
    const rest = (queue?.claims ?? []).map((item) => item.id).filter((id) => id !== row.id);
    focusAfter.current = rest[0] ?? "";
    setError("");
    setNotice(
      kind === "approve"
        ? `${row.claimantName || "They"} now hosts ${row.name}.`
        : `Claim turned down. ${row.claimantName || "They"} can ask again.`,
    );
    await reload();
  }

  const queueEmpty = (queue?.listings.length ?? 0) === 0 && (queue?.claims.length ?? 0) === 0;
  const alert = error ? (
    <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      {canDecide ? (
        <section className="card pc-card flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="queue-h">
          <div className="flex flex-col gap-1">
            <h3
              id="queue-h"
              ref={queueHead}
              tabIndex={-1}
              className="font-display text-2xl text-fg"
            >
              Claims to review
            </h3>
            <p className="text-sm text-muted">Only stewards and admins see this part.</p>
          </div>
          {errorWhere === "queue" ? alert : null}
          {notice ? (
            <p role="status" aria-live="polite" className="text-sm text-fg">
              {notice}
            </p>
          ) : null}
          {queue && queueEmpty ? (
            <p ref={emptyRef} tabIndex={-1} className="text-sm text-muted">
              Nothing to review. New claims will show up here.
            </p>
          ) : null}
          {queue?.listings.map((row) => (
            <article key={row.id} className="rounded-md border border-line p-3">
              <h4 className="text-base text-fg">{row.name}</h4>
              <p className="text-sm text-muted">{placeLine(row)}</p>
              <p className="text-sm text-muted">{row.status === "draft" ? "Draft" : "Unclaimed"}</p>
              {row.sourceUrl ? (
                <a
                  href={row.sourceUrl}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex min-h-11 items-center text-sm break-all text-signal underline"
                >
                  Open their site
                </a>
              ) : null}
            </article>
          ))}
          {queue?.claims.map((row) => (
            <article key={row.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
              <h4
                tabIndex={-1}
                ref={(node) => {
                  if (node) headings.current.set(row.id, node);
                  else headings.current.delete(row.id);
                }}
                className="text-base text-fg"
              >
                {row.name}
              </h4>
              <p className="text-sm text-muted">
                {placeLine(row)}
                {row.claimantName ? ` · ${row.claimantName}` : ""}
              </p>
              <p className="text-sm text-muted">
                {isMethod(row.method) ? CLAIM_METHOD_LABEL[row.method] : row.method}
                {row.verified ? (
                  <span className="text-signal">
                    {row.method === "domain_email"
                      ? " · Email code checked"
                      : " · Code found on their site"}
                  </span>
                ) : null}
              </p>
              {row.token ? (
                <p className="text-sm text-muted">
                  Code to look for: <code className="text-fg">{row.token}</code>
                </p>
              ) : null}
              {row.email ? (
                <p className="text-sm text-muted">
                  Email given: <span className="text-fg">{row.email}</span>
                </p>
              ) : null}
              {row.sourceUrl ? (
                <a
                  href={row.sourceUrl}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex min-h-11 items-center text-sm break-all text-signal underline"
                >
                  Open their site
                </a>
              ) : null}
              {canReview(row) ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  {row.method === "site_code" && !row.verified ? (
                    <button
                      type="button"
                      className={cn(btnGhost, "w-full sm:w-auto")}
                      onClick={() => {
                        setNotice("");
                        void apiFetch(`/api/claims/${row.id}/check`, {
                          method: "POST",
                          credentials: "include",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({}),
                        }).then(async (response) => {
                          const json = (await response.json().catch(() => null)) as {
                            error?: string;
                          } | null;
                          if (!response.ok) {
                            showError("queue", claimError(json, "That page was not checked."));
                            return;
                          }
                          setError("");
                          setNotice("Code found. You can approve it now.");
                          await reload();
                        });
                      }}
                    >
                      I found the code
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={cn(btnSignal, "w-full sm:w-auto")}
                    onClick={() => {
                      setPending(row);
                      setPendingKind("approve");
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={cn(btnGhost, "w-full border-danger/60 text-danger sm:w-auto")}
                    onClick={() => {
                      setPending(row);
                      setPendingKind("reject");
                    }}
                  >
                    Turn down
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          {queue && queue.log.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h4 className="text-base text-fg">Decided</h4>
              {queue.log.map((row) => (
                <p key={row.id} className="text-sm text-muted">
                  {DECIDED_LABEL[row.state] ?? row.state} · {row.name}
                  {row.claimantName ? ` · ${row.claimantName}` : ""}
                  {when(row.decidedAt ?? row.createdAt)
                    ? ` · ${when(row.decidedAt ?? row.createdAt)}`
                    : ""}
                </p>
              ))}
            </div>
          ) : null}
          <ConfirmDialog
            open={pending !== null && pendingKind === "reject"}
            tone="danger"
            title="Turn down this claim?"
            description={`${pending?.claimantName || "They"} won't host ${pending?.name || "this listing"}. They can ask again.`}
            confirmLabel="Turn down"
            cancelLabel="Not now"
            onConfirm={() => {
              if (pending) void settle("reject", pending);
            }}
            onCancel={() => setPending(null)}
          />
          <ConfirmDialog
            open={pending !== null && pendingKind === "approve"}
            tone="neutral"
            title={`Make ${pending?.claimantName || "this person"} host of ${pending?.name || "this listing"}?`}
            description="They become the host. The listing opens for members, and public sharing stays off."
            confirmLabel="Make host"
            cancelLabel="Not now"
            onConfirm={() => {
              if (pending) void settle("approve", pending);
            }}
            onCancel={() => setPending(null)}
          />
        </section>
      ) : null}

      <section className="card pc-card flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="claim-h">
        <div className="flex flex-col gap-2">
          <h3 id="claim-h" className="font-display text-2xl text-fg">
            Claim your church or group
          </h3>
          <p className="max-w-prose text-sm text-muted">
            Run a church or group that's already listed here? Claim it to become its host and run
            its room. You show it's yours in one of the ways below, then a steward checks and hands
            it to you. Until then, only stewards can see the listing.
          </p>
        </div>
        {errorWhere === "form" ? alert : null}
        {loadError ? (
          <p role="status" className="text-sm text-muted">
            {loadError}
          </p>
        ) : null}
        {notice && !canDecide ? (
          <p role="status" aria-live="polite" className="text-sm text-fg">
            {notice}
          </p>
        ) : null}
        {issued ? (
          <div className="flex flex-col gap-2 rounded-md border border-line p-3">
            <h4 className="text-base text-fg">Step 2 of 2: add this code to your website</h4>
            <p className="font-mono text-lg text-fg">{issued}</p>
            <button
              type="button"
              className={cn(btnGhost, "min-h-11 w-full sm:w-auto")}
              onClick={() => {
                void navigator.clipboard?.writeText(issued);
                setNotice("The code is copied.");
              }}
            >
              Copy
            </button>
            <p className="text-sm text-muted">
              Put it anywhere on your homepage or About page. A steward will check it, usually
              within a few days.
            </p>
          </div>
        ) : null}
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (sendingRef.current) return;
            setNotice("");
            if (!roomId) {
              // aria-disabled, not disabled: the button stays in the tab order and says why.
              setErrorWhere("form");
              setError("Find and choose your listing first.");
              listingRef.current?.focus();
              return;
            }
            if (chosen === "domain_email" && !email.trim()) {
              emailRef.current?.focus();
              showError("form", "Enter an email address.");
              return;
            }
            sendingRef.current = true;
            setSending(true);
            void apiFetch("/api/claims", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ roomId, method: chosen, email }),
            })
              .then(async (response) => {
                const json = (await response.json().catch(() => null)) as {
                  error?: string;
                  claim?: { token?: string };
                } | null;
                if (!response.ok) {
                  showError("form", claimError(json, "That claim was not opened."));
                  return;
                }
                setError("");
                setRoomId("");
                setFilter("");
                if (json?.claim?.token) {
                  setIssued(json.claim.token);
                  setNotice("The code is ready to copy.");
                } else {
                  setIssued("");
                  setNotice("The claim is open.");
                }
                await reload();
              })
              .catch(() => showError("form", CLAIM_NOT_SENT))
              .finally(() => {
                sendingRef.current = false;
                setSending(false);
              });
          }}
        >
          <h4 className="text-base font-semibold text-fg">Step 1 of 2: Find your listing</h4>
          <ListingPicker
            inputRef={listingRef}
            choices={choices}
            picked={picked}
            query={filter}
            onQuery={setFilter}
            onPick={(id) => {
              setRoomId(id);
              if (errorWhere === "form") {
                setError("");
                setErrorWhere("");
              }
            }}
            onNotListed={onNotListed}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-semibold text-fg">
              How you'll show it's yours
            </legend>
            {methods.map((item) => (
              <label
                key={item}
                className={cn(
                  "proof-option flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border p-3",
                  "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-fg",
                  chosen === item ? "border-fg bg-raised" : "border-line",
                )}
              >
                {/* The radio's name is the short title; the hint is its description, not part of its name. */}
                <input
                  type="radio"
                  name="claim-method"
                  value={item}
                  aria-labelledby={`${proofId}-${item}-title`}
                  aria-describedby={`${proofId}-${item}-hint`}
                  className="mt-0.5 size-5 shrink-0 rounded-full accent-[var(--color-fg)] focus-visible:outline-none"
                  checked={chosen === item}
                  onChange={() => setMethod(item)}
                />
                <span className="flex flex-col gap-1">
                  <span id={`${proofId}-${item}-title`} className="text-base text-fg">
                    {CLAIM_METHOD_LABEL[item]}
                  </span>
                  <span id={`${proofId}-${item}-hint`} className="text-sm text-muted">
                    {CLAIM_METHOD_HINT[item]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {chosen === "domain_email" ? (
            <label className="flex flex-col gap-2 text-sm text-muted">
              Your email at the organization's website domain
              <input
                autoComplete="email"
                ref={emailRef}
                required
                className={fieldClass}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          ) : null}
          <div className="flex flex-col gap-2">
            <button
              type="submit"
              aria-disabled={!roomId || sending || undefined}
              aria-busy={sending || undefined}
              aria-describedby={roomId ? undefined : "claim-submit-hint"}
              className={cn(
                btnSignal,
                "w-full justify-self-start aria-disabled:not-aria-busy:opacity-50 aria-busy:opacity-75 sm:w-auto sm:self-start",
              )}
            >
              {sending ? "Sending…" : "Request the claim"}
            </button>
            {/* A focused button's new name is not always spoken, so the same words go to a polite status
                that is mounted from the start, for members and stewards alike (Design #123 Low 1). */}
            <span role="status" aria-live="polite" className="sr-only">
              {sending ? "Sending your request…" : ""}
            </span>
            {roomId ? null : (
              <p id="claim-submit-hint" className="text-sm text-muted">
                Find and choose your listing first.
              </p>
            )}
          </div>
        </form>
        {queue?.claims.some((row) => row.mine && row.method === "domain_email" && !row.verified) ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const open = queue.claims.find(
                (row) => row.mine && row.method === "domain_email" && !row.verified,
              );
              if (!open) return;
              setNotice("");
              void apiFetch(`/api/claims/${open.id}/confirm`, {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ code }),
              }).then(async (response) => {
                const json = (await response.json().catch(() => null)) as { error?: string } | null;
                if (!response.ok) {
                  showError("form", claimError(json, "That code was not accepted."));
                  return;
                }
                setError("");
                setNotice("The email code is checked. A steward still approves the claim.");
                setCode("");
                await reload();
              });
            }}
          >
            <h4 className="text-base text-fg">Step 2 of 2: enter the code from your email</h4>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Email code
              <input
                required
                className={fieldClass}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button type="submit" className={cn(btnGhost, "w-full sm:w-auto")}>
              Confirm the code
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}

/** How many matches the list shows at once. The rest wait for a narrower search. */
export const PICKER_LIMIT = 8;

/** Matches in the order the server sent them. Nothing is ranked. */
export function matchListings(rows: ListingRow[], query: string): ListingRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return rows.filter((row) =>
    `${row.name} ${row.town} ${row.county}`.toLowerCase().includes(needle),
  );
}

/** "1 listing matches." or "N listings match." for the picker's polite hint. */
export function matchCount(count: number): string {
  return count === 1 ? "1 listing matches." : `${count} listings match.`;
}

function listingLine(row: ListingRow): string {
  return [row.town, row.county].filter(Boolean).join(", ");
}

/**
 * One search field. Matches show in a listbox as you type (the ARIA combobox
 * pattern). Picking one shows it with a Change button.
 */
export function ListingPicker({
  choices,
  picked,
  query,
  onQuery,
  onPick,
  onNotListed,
  inputRef,
}: {
  choices: ListingRow[];
  picked: ListingRow | null;
  query: string;
  onQuery: (value: string) => void;
  onPick: (id: string) => void;
  onNotListed?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const base = useId();
  const listId = `${base}-list`;
  const inputId = `${base}-input`;
  const hintId = `${base}-hint`;
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);
  const focusInput = useRef(false);
  const matches = matchListings(choices, query);
  const shown = matches.slice(0, PICKER_LIMIT);
  const typed = query.trim().length > 0;
  const expanded = open && typed && shown.length > 0;

  // The first match is highlighted as soon as there is one, so Enter picks what is shown and announced.
  useEffect(() => {
    setActive(shown.length > 0 ? 0 : -1);
  }, [query, shown.length]);

  // Keyed on the id, not the object: a queue reload rebuilds the listing objects, and that must not move focus.
  const pickedId = picked?.id ?? "";
  useEffect(() => {
    if (pickedId) changeRef.current?.focus();
    else if (focusInput.current) {
      focusInput.current = false;
      inputRef?.current?.focus();
    }
  }, [pickedId, inputRef]);

  if (picked) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">Your listing</p>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-raised px-3 py-2">
          <p className="flex flex-col">
            <span className="text-base text-fg">{picked.name}</span>
            {listingLine(picked) ? (
              <span className="text-sm text-muted">{listingLine(picked)}</span>
            ) : null}
          </p>
          <button
            ref={changeRef}
            type="button"
            className="inline-flex min-h-[44px] items-center px-1 text-sm text-fg underline underline-offset-4"
            aria-label={`Change listing, now ${picked.name}`}
            onClick={() => {
              focusInput.current = true;
              setOpen(true);
              onPick("");
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  const pick = (row: ListingRow) => {
    setOpen(false);
    onPick(row.id);
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm text-muted">
        Search for your church or group by name or town
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-describedby={hintId}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          className={fieldClass}
          value={query}
          onChange={(event) => {
            onQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Tab away or click outside closes the list (options keep focus here with onMouseDown preventDefault).
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && shown.length > 0) {
              event.preventDefault();
              setOpen(true);
              setActive((index) => (index + 1) % shown.length);
            } else if (event.key === "ArrowUp" && shown.length > 0) {
              event.preventDefault();
              setActive((index) => (index <= 0 ? shown.length - 1 : index - 1));
            } else if (event.key === "Enter" && expanded) {
              event.preventDefault();
              const row = active >= 0 ? shown[active] : undefined;
              if (row) pick(row);
            } else if (event.key === "Escape") {
              // APG combobox: Escape closes an open list; on a closed list it clears the field.
              if (expanded) setOpen(false);
              else if (query) {
                event.preventDefault();
                onQuery("");
              }
            }
          }}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching listings"
          hidden={!expanded}
          className="mt-1 flex flex-col overflow-hidden rounded-md border border-line-strong bg-raised"
        >
          {shown.map((row, index) => (
            <li
              key={row.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn(
                "flex min-h-[44px] cursor-pointer flex-col justify-center px-3 py-2",
                index === active ? "bg-surface outline outline-2 -outline-offset-2 outline-fg" : "",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(row)}
            >
              <span className="text-base text-fg">{row.name}</span>
              {listingLine(row) ? (
                <span className="text-sm text-muted">{listingLine(row)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <div id={hintId} aria-live="polite" className="text-sm text-muted">
        {!typed ? (
          <p>Start typing, then choose your listing from the list.</p>
        ) : matches.length === 0 ? (
          <p>
            No listing matches "{query.trim()}". Not listed?{" "}
            {onNotListed ? (
              <button
                type="button"
                className="inline-flex min-h-[44px] items-center text-fg underline underline-offset-4"
                onClick={onNotListed}
              >
                Ask for it with Request a new place
              </button>
            ) : (
              "Ask a steward to add it."
            )}
          </p>
        ) : matches.length > shown.length ? (
          <p>More listings match. Keep typing to narrow it down.</p>
        ) : (
          <p>{matchCount(matches.length)} Use the up and down arrows to choose.</p>
        )}
      </div>
    </div>
  );
}
