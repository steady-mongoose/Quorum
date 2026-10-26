import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { StatsView } from "@/components/board/stats-view";
import { APP_NAME } from "@/lib/board/model";
import { isStatsPayload, type StatsPayload } from "@/lib/board/stats";
import { apiFetch } from "@/lib/api-base";

export const Route = createFileRoute("/admin/stats")({
  head: () => ({
    meta: [{ title: `Stats · ${APP_NAME}` }, { name: "robots", content: "noindex" }],
  }),
  component: AdminStatsPage,
});

type Load =
  { kind: "loading" } | { kind: "ready"; stats: StatsPayload } | { kind: "message"; text: string };

function AdminStatsPage() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [csvError, setCsvError] = useState("");

  useEffect(() => {
    let cancel = false;
    void apiFetch("/api/admin/stats", { credentials: "include" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (cancel) return;
        if (response.status === 401) {
          setLoad({ kind: "message", text: "Sign in first." });
          return;
        }
        if (response.status === 403) {
          setLoad({ kind: "message", text: "This page is for an admin." });
          return;
        }
        if (response.status === 503) {
          setLoad({ kind: "message", text: "Stats are kept on the server." });
          return;
        }
        if (!response.ok || !isStatsPayload(body)) {
          setLoad({ kind: "message", text: "The stats could not be loaded." });
          return;
        }
        setLoad({ kind: "ready", stats: body });
      })
      .catch(() => {
        if (!cancel) setLoad({ kind: "message", text: "The stats could not be loaded." });
      });
    return () => {
      cancel = true;
    };
  }, []);

  async function downloadCsv() {
    setCsvError("");
    const response = await apiFetch("/api/admin/stats.csv", { credentials: "include" });
    if (!response.ok) {
      setCsvError("The export could not be downloaded.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "stats.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <Link to="/" className="text-sm text-muted">
          {APP_NAME}
        </Link>
        <h1 className="text-4xl text-fg">Stats</h1>
        <p className="max-w-prose text-sm text-muted">
          Counts only. A count under 5 is shown as &lt;5. No one is listed.
          {load.kind === "ready" && load.stats.asOf ? ` As of ${formatDay(load.stats.asOf)}.` : ""}
        </p>
      </header>
      {load.kind === "loading" ? <p className="text-sm text-muted">Loading stats.</p> : null}
      {load.kind === "message" ? (
        <p className="text-fg" role="status">
          {load.text}{" "}
          {load.text === "Sign in first." ? (
            <Link to="/" className="underline">
              Back to the door.
            </Link>
          ) : null}
        </p>
      ) : null}
      {load.kind === "ready" && load.stats.asOf === null ? (
        <p className="text-sm text-muted">
          The nightly rollup has not written a completed day yet.
        </p>
      ) : null}
      {load.kind === "ready" ? (
        <StatsView stats={load.stats} onCsv={() => void downloadCsv()} csvError={csvError} />
      ) : null}
    </main>
  );
}

function formatDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}
