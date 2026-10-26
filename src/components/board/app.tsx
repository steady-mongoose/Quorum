import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  LayoutList,
  MessageSquare,
  Phone,
  Search,
  User,
} from "lucide-react";
import { btnGhost, btnQuiet, IconNav } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { UNDO_BAR_MS, UNDO_TTL_MS, useBoard } from "@/lib/board/store";
import { useQuorum } from "@/lib/quorum/store";
import { APP_NAME, TAGLINE, type Section } from "@/lib/board/model";
import { AboutView } from "@/components/board/about-view";
import { DmView } from "@/components/board/dm-view";
import { Door } from "@/components/board/door";
import { FindView } from "@/components/board/find-view";
import { ProfileView } from "@/components/board/profile-view";
import { RoomView } from "@/components/board/room-view";
import { SessionLine } from "@/components/board/line";
import { WeekView } from "@/components/board/week-view";
import { QuorumPanel } from "@/components/quorum/app";
import { Emblem } from "@/components/board/emblem";
import { OWNER_THEME, themeById, themeVars } from "@/lib/board/themes";
import { ServerSessionProvider } from "@/lib/server-session";
import { useServerSession } from "@/lib/server-session-state";

const NAV = [
  { id: "week", label: "This week", icon: CalendarDays },
  { id: "rooms", label: "Rooms", icon: LayoutList },
  { id: "find", label: "Find", icon: Search },
  { id: "civic", label: "The desk", icon: Phone },
  { id: "messages", label: "Messages", icon: MessageSquare },
  { id: "profile", label: "You", icon: User },
  { id: "about", label: "About", icon: BookOpen },
] satisfies { id: Section; label: string; icon: typeof CalendarDays }[];

const MOBILE_NAV = NAV.filter(
  (item) =>
    item.id === "week" ||
    item.id === "rooms" ||
    item.id === "find" ||
    item.id === "messages" ||
    item.id === "profile",
);

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="h-28 animate-pulse rounded-lg bg-raised motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

export function BoardApp() {
  return (
    <ServerSessionProvider>
      <BoardShell />
    </ServerSessionProvider>
  );
}

function BoardShell() {
  const section = useBoard((state) => state.section);
  const setSection = useBoard((state) => state.setSection);
  const view = useBoard((state) => state.view);
  const me = useBoard((state) => state.me);
  const member = useBoard((state) => state.member);
  const sample = useBoard((state) => state.sample);
  const localEntry = useBoard((state) => state.localEntry);
  const undoClear = useBoard((state) => state.undoClear);
  const undoClearBoard = useBoard((state) => state.undoClearBoard);
  const boardError = useBoard((state) => state.boardError);
  const ownAppeals = useBoard((state) => state.appeals);
  const undoButton = useRef<HTMLButtonElement>(null);
  const [undoBar, setUndoBar] = useState(false);
  const [boardLoading, setBoardLoading] = useState(false);
  const server = useServerSession();
  const theme = themeById(OWNER_THEME);
  const waiting = server.mode === "pending";
  const entered = server.mode === "live" ? Boolean(server.user) || sample || localEntry : member;
  const busy = waiting || boardLoading;

  useEffect(() => {
    void useBoard.persist.rehydrate();
    void useQuorum.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (!undoClear) {
      setUndoBar(false);
      return;
    }
    const remaining = undoClear.at + UNDO_TTL_MS - Date.now();
    if (remaining <= 0) {
      useBoard.setState({ undoClear: null });
      return;
    }
    const expire = window.setTimeout(() => useBoard.setState({ undoClear: null }), remaining);
    setUndoBar(true);
    const hide = window.setTimeout(() => setUndoBar(false), UNDO_BAR_MS);
    return () => {
      window.clearTimeout(expire);
      window.clearTimeout(hide);
    };
  }, [undoClear]);

  useEffect(() => {
    if (undoClear && undoBar) undoButton.current?.focus();
  }, [undoClear, undoBar]);

  useEffect(() => {
    if (server.mode !== "live" || !server.user) return;
    const name = server.user.name.trim();
    if (!name) return;
    const state = useBoard.getState();
    if (state.sample) state.clearBoard();
    const next = useBoard.getState();
    if (next.me !== name || !next.member || next.sample) {
      useBoard.setState({ member: true, me: name, sample: false });
    }
    let cancel = false;
    setBoardLoading(true);
    void useBoard.getState().connectRemote().finally(() => {
      if (!cancel) setBoardLoading(false);
    });
    return () => {
      cancel = true;
    };
  }, [server.mode, server.user]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-bg text-fg" style={themeVars(theme)}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-md focus:bg-signal focus:px-4 focus:text-sm focus:font-semibold focus:text-signal-ink"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-bg">
        <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-3 px-[clamp(1rem,4vw,4rem)] pt-4 pb-3 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
          <div className="flex items-start justify-between gap-4 lg:shrink-0 lg:items-center lg:gap-6">
            <div>
              <p className="font-display text-3xl leading-none text-fg lg:text-4xl">{APP_NAME}</p>
              <p className="mt-2 text-sm text-muted lg:whitespace-nowrap">{TAGLINE}</p>
            </div>
            <Emblem theme={theme.id} size="header" />
          </div>
          {entered ? (
            <IconNav
              className="hidden md:flex"
              items={NAV}
              current={section}
              onSelect={(id) => (id === "profile" ? view(me.trim()) : setSection(id))}
              label="Sections"
            />
          ) : null}
          {server.user ? (
            <button
              type="button"
              className="inline-flex min-h-[44px] items-center self-start text-sm text-signal underline"
              onClick={() => {
                void server.signOut().then(() => {
                  useBoard.getState().disconnectRemote();
                });
              }}
            >
              Sign out
            </button>
          ) : null}
        </div>
      </header>
      {boardError ? (
        <div className="border-b border-signal bg-surface px-[clamp(1rem,4vw,4rem)] py-2 text-sm text-signal">
          <p>{boardError}</p>
          {boardError === "This account is barred from the board." && ownAppeals.length > 0 ? (
            <ul className="mt-1 text-muted">
              {ownAppeals.map((row) => (
                <li key={row.id}>
                  Your {row.kind} appeal is{" "}
                  {row.decision === "lift" ? "lifted" : row.decision === "uphold" ? "upheld" : "open"}.
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {entered && sample ? (
        <p className="border-b border-signal bg-surface px-[clamp(1rem,4vw,4rem)] py-2 text-sm text-muted">
          <span className="font-semibold text-signal">Sample week.</span> Everyone here (Josh, Tom,
          Dale, Maria, Luis, Ruth, Pete) and everything they wrote is invented, to show what the app
          looks like in use.{" "}
          <button
            type="button"
            className="text-signal underline"
            onClick={() => setSection("about")}
          >
            Clear the sample week…
          </button>{" "}
          when you are ready to use it for real.
        </p>
      ) : null}
      {entered && undoClear && undoBar ? (
        <div className="border-b border-line bg-surface" role="status">
          <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-center justify-between gap-3 px-[clamp(1rem,4vw,4rem)] py-3">
            <p className="max-w-prose text-sm text-muted">
              The board is cleared. You can put it back.
            </p>
            <span className="flex flex-wrap gap-2">
              <button
                ref={undoButton}
                type="button"
                className={cn(btnGhost, "min-h-[44px]")}
                onClick={() => undoClearBoard()}
              >
                Undo
              </button>
              <button
                type="button"
                className={cn(btnQuiet, "min-h-[44px]")}
                onClick={() => setUndoBar(false)}
              >
                Close
              </button>
            </span>
          </div>
        </div>
      ) : null}
      <main
        id="main"
        tabIndex={-1}
        aria-busy={busy || undefined}
        className="mx-auto w-full max-w-[100rem] px-[clamp(1rem,4vw,4rem)] pt-6 pb-28 md:pb-24"
      >
        {busy ? (
          <>
            <p className="sr-only">Checking the server.</p>
            <BoardSkeleton />
          </>
        ) : null}
        {!busy && !entered && <Door />}
        {!busy && entered && section === "week" && <WeekView />}
        {!busy && entered && section === "rooms" && <RoomView />}
        {!busy && entered && section === "find" && <FindView />}
        {!busy && entered && section === "civic" && <QuorumPanel />}
        {!busy && entered && section === "messages" && <DmView />}
        {!busy && entered && section === "profile" && <ProfileView />}
        {!busy && entered && section === "about" && <AboutView />}
      </main>
      {entered ? (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
          aria-label="Sections"
        >
          {MOBILE_NAV.map((item) => {
            const Icon = item.icon;
            const current = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={current ? "page" : undefined}
                onClick={() => (item.id === "profile" ? view(me.trim()) : setSection(item.id))}
                className={cn(
                  "inline-flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 text-[13px] font-semibold",
                  current ? "text-fg" : "text-muted",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>
      ) : null}
      {entered ? <SessionLine /> : null}
    </div>
  );
}
