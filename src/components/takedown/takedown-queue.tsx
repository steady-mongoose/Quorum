import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { btnGhost, btnSignal, fieldClass } from "@/components/quorum/bits";
import { apiFetch } from "@/lib/api-base";
import { useBoard } from "@/lib/board/store";
import { countdownLabel, isUrgent } from "@/lib/takedown/countdown";

export type TakedownRow = {
  id: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string;
  contentUrl: string;
  description: string;
  signature: string;
  status: "open" | "removed" | "declined";
  removedCount: number;
  decisionNote: string;
  createdAt: number;
  dueAt: number;
};

export type TakedownApi = {
  list: () => Promise<{ ok: true; rows: TakedownRow[] } | { ok: false; error: string }>;
  remove: (id: string, media: string[], note: string) => Promise<string>;
  decline: (id: string, note: string) => Promise<string>;
};

async function call(path: string, body?: unknown): Promise<{ ok: boolean; json: any }> {
  const response = await apiFetch(path, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, json: await response.json().catch(() => null) };
}

export const REMOVE_CONFIRM = "Remove these files and every identical copy? This can't be undone.";
export const DECLINE_CONFIRM = "Close this request without removing anything? We will email the requester.";

export const takedownApi: TakedownApi = {
  async list() {
    const { ok, json } = await call("/api/takedown");
    return ok && Array.isArray(json?.requests)
      ? { ok: true, rows: json.requests as TakedownRow[] }
      : { ok: false, error: json?.error || "The requests did not load." };
  },
  async remove(id, media, note) {
    const { ok, json } = await call(`/api/takedown/${id}/remove`, { media, note });
    return ok ? "" : json?.error || "That did not go through.";
  },
  async decline(id, note) {
    const { ok, json } = await call(`/api/takedown/${id}/decline`, { note });
    return ok ? "" : json?.error || "That did not go through.";
  },
};

/** The notice at the top of an admin's Home while any request is open. */
export function takedownNotice(count: number, dueAt: number, now: number): string {
  const what = count === 1 ? "1 removal request is open" : `${count} removal requests are open`;
  const when = new Date(dueAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${what}. The law gives us 48 hours. The next one is due ${when} (${countdownLabel(dueAt, now)}).`;
}

/** Admin-only list of removal requests, each with its 48-hour countdown. */
export function TakedownPanel() {
  const admin = useBoard((state) => state.admin);
  if (!admin) return null;
  return <TakedownQueue api={takedownApi} />;
}

export function TakedownQueue({ api, now: fixedNow }: { api: TakedownApi; now?: number }) {
  const [rows, setRows] = useState<TakedownRow[]>([]);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(() => fixedNow ?? Date.now());
  const [status, setStatus] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAt = useRef<number | null>(null);

  const load = () =>
    api.list().then((result) => {
      if (result.ok) {
        setRows(result.rows);
        setError("");
      } else setError(result.error);
    });

  // After a remove or close, focus the next request's first button, or the heading when none are left.
  useEffect(() => {
    const index = focusAt.current;
    if (index === null) return;
    focusAt.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLElement>("[data-first-action]") ?? [];
    const next = buttons[Math.min(index, buttons.length - 1)];
    if (next) next.focus();
    else headingRef.current?.focus();
  }, [rows]);

  useEffect(() => {
    void load();
    if (fixedNow !== undefined) return;
    const timer = window.setInterval(() => setTick(Date.now()), 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = rows.filter((row) => row.status === "open");
  const first = [...open].sort((a, b) => a.dueAt - b.dueAt)[0];
  return (
    <section className="mt-6 flex flex-col gap-3 border-t border-line pt-4" aria-labelledby="takedown-heading">
      <h2 id="takedown-heading" ref={headingRef} tabIndex={-1} className="kicker">
        Intimate image removal requests
      </h2>
      {first ? (
        <p
          data-takedown-notice=""
          className="rounded-lg border-2 border-danger bg-surface p-4 text-base font-semibold text-danger"
        >
          {takedownNotice(open.length, first.dueAt, tick)}
        </p>
      ) : null}
      <p role="status" className="sr-only">
        {status}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {open.length === 0 && !error ? <p className="text-sm text-muted">No open requests.</p> : null}
      <ol ref={listRef} className="flex flex-col gap-4">
        {open.map((row, index) => (
          <TakedownItem
            key={row.id}
            row={row}
            now={tick}
            api={api}
            onDone={(message) => {
              focusAt.current = index;
              setStatus(message);
              void load();
            }}
          />
        ))}
      </ol>
    </section>
  );
}

function TakedownItem({
  row,
  now,
  api,
  onDone,
}: {
  row: TakedownRow;
  now: number;
  api: TakedownApi;
  onDone: (message: string) => void;
}) {
  const [media, setMedia] = useState(row.contentUrl);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [confirm, setConfirm] = useState<"remove" | "decline" | null>(null);
  const urgent = isUrgent(row.dueAt, now);
  const run = (work: () => Promise<string>, done: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void work().then((failure) => {
      busyRef.current = false;
      setBusy(false);
      if (failure) setError(failure);
      else onDone(done);
    });
  };
  return (
    <li className="card flex flex-col gap-2 rounded-lg border border-line p-4 text-sm">
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>{row.id}</strong>
        <span className={urgent ? "font-semibold text-danger" : "text-muted"} data-countdown="">
          {countdownLabel(row.dueAt, now)}
        </span>
      </p>
      <p>
        From {row.requesterName} ({row.requesterEmail}
        {row.requesterPhone ? `, ${row.requesterPhone}` : ""}). Signed: {row.signature}.
      </p>
      {row.contentUrl ? <p className="break-all">Link: {row.contentUrl}</p> : null}
      {row.description ? <p className="whitespace-pre-wrap">{row.description}</p> : null}
      <label className="flex flex-col gap-1">
        Files to remove (links or IDs, one per line). Identical copies are removed too.
        <textarea
          className={fieldClass}
          rows={2}
          value={media}
          onChange={(event) => setMedia(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        Note for the record
        <input className={fieldClass} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${btnSignal} min-h-[44px]`}
          data-first-action=""
          aria-disabled={busy || undefined}
          aria-label={`Remove files for ${row.id}`}
          onClick={() => {
            if (!busy) setConfirm("remove");
          }}
        >
          Remove files
        </button>
        <button
          type="button"
          className={`${btnGhost} min-h-[44px]`}
          aria-disabled={busy || undefined}
          aria-label={`Close ${row.id} without removing`}
          onClick={() => {
            if (!busy) setConfirm("decline");
          }}
        >
          Close without removing
        </button>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "decline" ? "Close without removing" : "Remove files"}
        description={confirm === "decline" ? DECLINE_CONFIRM : REMOVE_CONFIRM}
        confirmLabel={confirm === "decline" ? "Close request" : "Remove files"}
        cancelLabel="Cancel"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action === "remove") {
            run(
              () => api.remove(row.id, media.split(/\s+/).filter(Boolean), note),
              `Removed files for ${row.id}.`,
            );
          } else if (action === "decline") {
            run(() => api.decline(row.id, note), `Closed ${row.id}.`);
          }
        }}
      />
    </li>
  );
}
