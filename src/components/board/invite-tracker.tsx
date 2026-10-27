import { useEffect, useState } from "react";
import { loadInvites, type InviteRow } from "@/lib/admin/invite-tracker";

function day(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** "2 of 5": how many times the code was used, out of how many it allows. */
export function usedLabel(row: Pick<InviteRow, "uses" | "maxUses">): string {
  return `${row.uses} of ${row.maxUses}`;
}

const cell = "px-3 py-2 align-top";

/** Admin only. Read only: no buttons that change anything. */
export function InviteTrackerTable({ rows }: { rows: InviteRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">No invites yet.</p>;
  return (
    <div
      role="region"
      aria-labelledby="invite-tracker-caption"
      tabIndex={0}
      className="overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <table className="w-full text-left text-sm">
        <caption id="invite-tracker-caption" className="px-3 pb-2 text-left text-sm text-muted">
          Invite codes, newest first, with who used each one
        </caption>
        <thead className="text-muted">
          <tr>
            <th scope="col" className={cell}>Note</th>
            <th scope="col" className={cell}>Created</th>
            <th scope="col" className={cell}>Expires</th>
            <th scope="col" className={cell}>Used</th>
            <th scope="col" className={cell}>By</th>
            <th scope="col" className={cell}>Email</th>
            <th scope="col" className={cell}>Last sign-in</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.id}-${index}`} className="border-t border-line">
              <td className={cell}>{row.note || "—"}</td>
              <td className={cell}>{day(row.createdAt)}</td>
              <td className={cell}>{day(row.expiresAt)}</td>
              <td className={cell}>{usedLabel(row)}</td>
              <td className={cell}>
                {row.redeemedBy ? `${row.redeemedBy}, ${day(row.redeemedAt)}` : "—"}
              </td>
              <td className={cell}>{row.memberEmail || "—"}</td>
              <td className={cell}>{day(row.lastSignIn)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InviteTracker() {
  const [rows, setRows] = useState<InviteRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void loadInvites().then((result) => {
      if (result.ok) setRows(result.rows);
      else setError(result.error);
    });
  }, []);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">Invites</h2>
      {error ? (
        <p role="alert" className="text-sm text-danger">{error}</p>
      ) : rows ? (
        <InviteTrackerTable rows={rows} />
      ) : (
        <p className="text-sm text-muted">Loading.</p>
      )}
    </section>
  );
}
