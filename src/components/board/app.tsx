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
  const undoButton = useRef<HTMLButtonElement>(null);
  const [undoBar, setUndoBar] = useState(false);
  const server = useServerSession();
  const theme = themeById(OWNER_THEME);
  const waiting = server.mode === "pending";
  const entered = server.mode === "live" ? Boolean(server.user) || sample || localEntry : member;

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
    void useBoard.getState().connectRemote();
  }, [server.mode, server.user]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-bg text-fg" style={themeVars(theme)}>
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
              items={NAV}
              current={section}
              onSelect={(id) => (id === "profile" ? view(me.trim()) : setSection(id))}
              label="Sections"
            />
          ) : null}
          {server.user ? (
            <button
              type="button"
              className="self-start text-sm text-signal underline"
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
        <p className="border-b border-signal bg-surface px-[clamp(1rem,4vw,4rem)] py-2 text-sm text-signal">
          {boardError}
        </p>
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
      <main className="mx-auto w-full max-w-[100rem] px-[clamp(1rem,4vw,4rem)] pt-6 pb-24">
        {waiting ? <p className="text-sm text-muted">Checking the server.</p> : null}
        {!waiting && !entered && <Door />}
        {entered && section === "week" && <WeekView />}
        {entered && section === "rooms" && <RoomView />}
        {entered && section === "find" && <FindView />}
        {entered && section === "civic" && <QuorumPanel />}
        {entered && section === "messages" && <DmView />}
        {entered && section === "profile" && <ProfileView />}
        {entered && section === "about" && <AboutView />}
      </main>
      {entered ? <SessionLine /> : null}
    </div>
  );
}
