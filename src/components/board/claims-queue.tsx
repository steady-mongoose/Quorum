import { useEffect, useState } from "react";
import { btnGhost, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { apiFetch } from "@/lib/api-base";
import {
  CLAIM_ALLOWED_METHODS,
  CLAIM_METHOD_LABEL,
  type ClaimMethod,
} from "@/lib/board/claim-policy";
import { useBoard } from "@/lib/board/store";

type ClaimRow = {
  id: string;
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

function isMethod(value: string): value is ClaimMethod {
  return value === "site_code" || value === "domain_email" || value === "steward_review";
}

function placeLine(row: { town: string; county: string; category: string }): string {
  return [row.town, row.county, row.category].filter(Boolean).join(", ");
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
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [method, setMethod] = useState<string>(CLAIM_ALLOWED_METHODS[0] ?? "site_code");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    const loaded = await readQueue();
    if (!loaded.ok) {
      setError(loaded.error);
      return;
    }
    setError("");
    setQueue(loaded.queue);
  }

  useEffect(() => {
    void reload();
  }, []);

  const methods = (queue?.methods.length ? queue.methods : [...CLAIM_ALLOWED_METHODS]).filter(
    isMethod,
  );
  const chosen = methods.includes(method as ClaimMethod) ? method : methods[0];
  const canDecide = steward || admin;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-2">
        <Kicker>Claims</Kicker>
        <h3 className="text-lg text-fg">Listings waiting for a host</h3>
        <p className="max-w-prose text-sm text-muted">
          A seeded listing stays off the public page until a host is approved. The code on the
          organization's site comes first. An email on that domain is second.
        </p>
      </div>

      {canDecide && queue ? (
        <div className="flex flex-col gap-3">
          {queue.listings.length === 0 ? (
            <p className="text-sm text-muted">No listings are waiting.</p>
          ) : (
            queue.listings.map((row) => (
              <article key={row.id} className="border-t border-line pt-3">
                <h4 className="text-base text-fg">{row.name}</h4>
                <p className="text-sm text-muted">{placeLine(row)}</p>
                <p className="text-sm text-muted">
                  {row.status === "draft" ? "Draft" : "Unclaimed"}
                </p>
                {row.sourceUrl ? (
                  <p className="text-sm break-all text-muted">{row.sourceUrl}</p>
                ) : null}
              </article>
            ))
          )}
          <h4 className="text-base text-fg">Open claims</h4>
          {queue.claims.length === 0 ? (
            <p className="text-sm text-muted">No claims are waiting.</p>
          ) : null}
          {queue.claims.map((row) => (
            <article key={row.id} className="flex flex-col gap-2 border-t border-line pt-3">
              <h4 className="text-base text-fg">{row.name}</h4>
              <p className="text-sm text-muted">
                {placeLine(row)}
                {row.claimantName ? ` · ${row.claimantName}` : ""}
              </p>
              <p className="text-sm text-muted">
                {isMethod(row.method) ? CLAIM_METHOD_LABEL[row.method] : row.method}
                {row.verified ? " · code checked" : ""}
              </p>
              {row.token ? <p className="text-sm break-all text-fg">{row.token}</p> : null}
              {row.email ? <p className="text-sm text-muted">{row.email}</p> : null}
              {row.sourceUrl ? (
                <p className="text-sm break-all text-muted">{row.sourceUrl}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {row.method === "site_code" && !row.verified ? (
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => {
                      setNotice("");
                      void apiFetch(`/api/claims/${row.id}/check`, {
                        method: "POST",
                        credentials: "include",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ found: true }),
                      }).then(async (response) => {
                        const json = (await response.json().catch(() => null)) as {
                          error?: string;
                        } | null;
                        if (!response.ok) setNotice(json?.error || "That page was not checked.");
                        await reload();
                      });
                    }}
                  >
                    The code is on the page
                  </button>
                ) : null}
                <button
                  type="button"
                  className={btnSignal}
                  onClick={() => {
                    setNotice("");
                    void apiFetch(`/api/claims/${row.id}/decide`, {
                      method: "POST",
                      credentials: "include",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ decision: "approve" }),
                    }).then(async (response) => {
                      const json = (await response.json().catch(() => null)) as {
                        error?: string;
                      } | null;
                      if (!response.ok) setNotice(json?.error || "That claim was not approved.");
                      await reload();
                    });
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => {
                    setNotice("");
                    void apiFetch(`/api/claims/${row.id}/decide`, {
                      method: "POST",
                      credentials: "include",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ decision: "reject" }),
                    }).then(async (response) => {
                      const json = (await response.json().catch(() => null)) as {
                        error?: string;
                      } | null;
                      if (!response.ok) setNotice(json?.error || "That claim was not rejected.");
                      await reload();
                    });
                  }}
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
          {queue.log.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h4 className="text-base text-fg">Decided</h4>
              {queue.log.map((row) => (
                <p key={row.id} className="text-sm text-muted">
                  {row.state} · {row.name}
                  {row.claimantName ? ` · ${row.claimantName}` : ""}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <form
        className="grid gap-3 border-t border-line pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice("");
          void apiFetch("/api/claims", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, method: chosen, email }),
          }).then(async (response) => {
            const json = (await response.json().catch(() => null)) as {
              error?: string;
              claim?: { token?: string };
            } | null;
            if (!response.ok) {
              setNotice(json?.error || "That claim was not opened.");
              return;
            }
            setName("");
            setNotice(
              json?.claim?.token
                ? `Put this on the organization's page: ${json.claim.token}`
                : "The claim is open.",
            );
            await reload();
          });
        }}
      >
        <h4 className="text-base text-fg">Claim a listing</h4>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Listing name
          <input
            className={fieldClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
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
              className={fieldClass}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        ) : null}
        <button type="submit" className={btnSignal}>
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
              if (!response.ok) setNotice(json?.error || "That code was not accepted.");
              else setNotice("The email code is checked. A steward still approves the claim.");
              setCode("");
              await reload();
            });
          }}
        >
          <label className="flex flex-col gap-2 text-sm text-muted">
            Email code
            <input
              className={fieldClass}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button type="submit" className={btnGhost}>
            Confirm the code
          </button>
        </form>
      ) : null}

      {notice ? <p className="text-sm text-fg">{notice}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
