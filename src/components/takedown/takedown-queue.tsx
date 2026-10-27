import { useEffect, useState } from "react";
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

  const load = () =>
    api.list().then((result) => {
      if (result.ok) {
        setRows(result.rows);
        setError("");
      } else setError(result.error);
    });

  useEffect(() => {
    void load();
    if (fixedNow !== undefined) return;
    const timer = window.setInterval(() => setTick(Date.now()), 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = rows.filter((row) => row.status === "open");
  return (
    <section className="mt-6 flex flex-col gap-3 border-t border-line pt-4" aria-labelledby="takedown-heading">
      <h2 id="takedown-heading" className="kicker">
        Intimate image removal requests
      </h2>
      <p role="status" className="sr-only">
        {status}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {open.length === 0 && !error ? <p className="text-sm text-muted">No open requests.</p> : null}
      <ol className="flex flex-col gap-4">
        {open.map((row) => (
          <TakedownItem
            key={row.id}
            row={row}
            now={tick}
            api={api}
            onDone={(message) => {
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
  const urgent = isUrgent(row.dueAt, now);
  const run = (work: Promise<string>, done: string) => {
    setBusy(true);
    void work.then((failure) => {
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
          disabled={busy}
          aria-label={`Remove files for ${row.id}`}
          onClick={() =>
            run(
              api.remove(row.id, media.split(/\s+/).filter(Boolean), note),
              `Removed files for ${row.id}.`,
            )
          }
        >
          Remove files
        </button>
        <button
          type="button"
          className={`${btnGhost} min-h-[44px]`}
          disabled={busy}
          aria-label={`Close ${row.id} without removing`}
          onClick={() => run(api.decline(row.id, note), `Closed ${row.id}.`)}
        >
          Close without removing
        </button>
      </div>
    </li>
  );
}
