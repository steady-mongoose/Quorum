import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { btnGhost, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { apiFetch } from "@/lib/api-base";
import { cn } from "@/lib/cn";
import {
  CLAIM_ALLOWED_METHODS,
  CLAIM_METHOD_LABEL,
  type ClaimMethod,
} from "@/lib/board/claim-policy";
import { useBoard } from "@/lib/board/store";

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
    return { ok: false, error: json?.error || "The claims queue is not available yet." };
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
export function ClaimsPanel() {
  const steward = useBoard((state) => state.steward);
  const admin = useBoard((state) => state.admin);
  const stewardRooms = useBoard((state) => state.stewardRooms);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [errorWhere, setErrorWhere] = useState<"queue" | "form" | "">("");
  const [roomId, setRoomId] = useState("");
  const [filter, setFilter] = useState("");
  const [method, setMethod] = useState<string>(CLAIM_ALLOWED_METHODS[0] ?? "site_code");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [issued, setIssued] = useState("");
  const [pending, setPending] = useState<ClaimRow | null>(null);
  const [pendingKind, setPendingKind] = useState<"approve" | "reject">("reject");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const listingRef = useRef<HTMLSelectElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);
  const queueHead = useRef<HTMLHeadingElement>(null);
  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const focusAfter = useRef<string | null>(null);

  async function reload() {
    const loaded = await readQueue();
    if (!loaded.ok) {
      setError(loaded.error);
      setErrorWhere("form");
      return;
    }
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
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? choices.filter((row) => `${row.name} ${row.town}`.toLowerCase().includes(needle))
    : choices;

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
      showError("queue", json?.error || "That claim was not decided.");
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
        <section className="plate flex flex-col gap-4" aria-labelledby="queue-h">
          <div className="flex flex-col gap-2">
            <Kicker>Claims</Kicker>
            <h3
              id="queue-h"
              ref={queueHead}
              tabIndex={-1}
              className="illum font-display text-3xl text-fg"
            >
              Claims to review
            </h3>
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
                            showError("queue", json?.error || "That page was not checked.");
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

      <section className="plate flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Kicker>Claim</Kicker>
          <h3 className="illum font-display text-3xl text-fg">Step 1 of 2: which listing?</h3>
          <p className="max-w-prose text-sm text-muted">
            Hosting a church or group that's already listed? Show us it's yours, and a steward will
            hand it over. Listings stay private until then.
          </p>
        </div>
        {errorWhere === "form" ? alert : null}
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
            setNotice("");
            if (!roomId) {
              listingRef.current?.focus();
              showError("form", "Choose a listing.");
              return;
            }
            if (chosen === "domain_email" && !email.trim()) {
              emailRef.current?.focus();
              showError("form", "Enter an email address.");
              return;
            }
            void apiFetch("/api/claims", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ roomId, method: chosen, email }),
            }).then(async (response) => {
              const json = (await response.json().catch(() => null)) as {
                error?: string;
                claim?: { token?: string };
              } | null;
              if (!response.ok) {
                showError("form", json?.error || "That claim was not opened.");
                return;
              }
              setError("");
              setRoomId("");
              if (json?.claim?.token) {
                setIssued(json.claim.token);
                setNotice("The code is ready to copy.");
              } else {
                setIssued("");
                setNotice("The claim is open.");
              }
              await reload();
            });
          }}
        >
          <label className="flex flex-col gap-2 text-sm text-muted">
            Search by name or town
            <input
              className={fieldClass}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Listing
            <select
              ref={listingRef}
              required
              className={fieldClass}
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
            >
              <option value="">Choose a listing</option>
              {shown.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.town ? `${row.name}, ${row.town}` : row.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm text-muted">How you show it is yours</legend>
            {methods.map((item) => (
              <label key={item} className="flex min-h-11 items-center gap-2 text-sm text-fg">
                <input
                  type="radio"
                  name="claim-method"
                  checked={chosen === item}
                  onChange={() => setMethod(item)}
                />
                {CLAIM_METHOD_LABEL[item]}
              </label>
            ))}
          </fieldset>
          {chosen === "domain_email" ? (
            <label className="flex flex-col gap-2 text-sm text-muted">
              Email on that domain
              <input
                ref={emailRef}
                required
                className={fieldClass}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          ) : null}
          <button type="submit" className={cn(btnSignal, "w-full sm:w-auto")}>
            Request the claim
          </button>
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
                  showError("form", json?.error || "That code was not accepted.");
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
