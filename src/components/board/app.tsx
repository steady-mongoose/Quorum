import { useEffect, useRef, useState, type MouseEvent } from "react";
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
import { UNDO_BAR_MS, UNDO_TTL_MS, canClearBoard, localBoardOwner, useBoard } from "@/lib/board/store";
import { useQuorum } from "@/lib/quorum/store";
import { APP_NAME, TAGLINE, type Section } from "@/lib/board/model";
import { AboutView } from "@/components/board/about-view";
import { DmView } from "@/components/board/dm-view";
import { Door } from "@/components/board/door";
import { FindView } from "@/components/board/find-view";
import { ProfileView } from "@/components/board/profile-view";
import { RoomView } from "@/components/board/room-view";
import { SectionTabs } from "@/components/board/section-tabs";
import { SessionLine } from "@/components/board/line";
import { WeekView } from "@/components/board/week-view";
import { QuorumPanel } from "@/components/quorum/app";
import { AppealMark } from "@/components/board/emblem";
import { PrimaryHaptic } from "@/components/board/haptics";
import { desktopNav } from "@/lib/board/phone-nav";
import { OWNER_THEME, themeById, themeVars } from "@/lib/board/themes";
import { ServerSessionProvider } from "@/lib/server-session";
import { useServerSession } from "@/lib/server-session-state";
import { artSection, heroLabel, showsHero } from "@/lib/board/engraved";
import { useEngravedDocument } from "@/components/board/engraved-ground";

const ICONS = {
  week: CalendarDays,
  rooms: LayoutList,
  find: Search,
  civic: Phone,
  messages: MessageSquare,
  profile: User,
  about: BookOpen,
} satisfies Record<Section, typeof CalendarDays>;

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
  const deskOn = useBoard((state) => state.deskOn);
  const view = useBoard((state) => state.view);
  const me = useBoard((state) => state.me);
  const member = useBoard((state) => state.member);
  const sample = useBoard((state) => state.sample);
  const admin = useBoard((state) => state.admin);
  const founded = useBoard((state) => state.founded);
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
  const apiDown = server.configured && server.mode === "demo";
  const signingIn = !entered && (server.mode === "live" || apiDown);
  const busy = waiting || boardLoading;
  const shown = section === "civic" && !deskOn ? "week" : section;
  const art = artSection({
    entered,
    section: shown,
    signingIn,
  });
  const hero = heroLabel(art);
  const margin = showsHero(art);
  useEngravedDocument(art);

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

  useEffect(() => {
    if (!deskOn && section === "civic") setSection("week");
  }, [deskOn, section, setSection]);

  const openSection = (id: Section) => (id === "profile" ? view(me.trim()) : setSection(id));

  const focusDoorField = (event: MouseEvent<HTMLAnchorElement>) => {
    const id = event.currentTarget.getAttribute("href")?.slice(1);
    if (!id) return;
    window.setTimeout(() => {
      const root = document.getElementById(id);
      const field = root?.querySelector<HTMLElement>("input, textarea, select, button");
      field?.focus();
    }, 0);
  };

  const page = busy ? (
    <>
      <p className="sr-only">Checking the server.</p>
      <BoardSkeleton />
    </>
  ) : (
    <>
      {!entered && <Door />}
      {entered && shown === "week" && <WeekView />}
      {entered && shown === "rooms" && <RoomView />}
      {entered && shown === "find" && <FindView />}
      {entered && shown === "civic" && deskOn && <QuorumPanel />}
      {entered && shown === "messages" && <DmView />}
      {entered && shown === "profile" && <ProfileView />}
      {entered && shown === "about" && <AboutView />}
    </>
  );

  return (
    <div className="shell min-h-dvh overflow-x-clip text-fg" style={themeVars(theme)}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-md focus:bg-signal focus:px-4 focus:text-sm focus:font-semibold focus:text-signal-ink"
      >
        Skip to content
      </a>
      <PrimaryHaptic />
      {art === "landing" || art === "signin" ? <div className="plate-ground" aria-hidden="true" /> : null}
      {art === "landing" || art === "signin" ? <div className="scrim" aria-hidden="true" /> : null}
      <header className="top mast-bar">
        <div className="mast">
          <div className="mast-brand">
            <AppealMark />
            <div className="mast-titles">
              <p className="mast-name">{APP_NAME}</p>
              <p className="mast-tagline">{TAGLINE}</p>
            </div>
          </div>
          <div className="mast-actions">
            {entered ? (
              <div className="topnav">
                <IconNav
                  items={desktopNav(deskOn).map((item) => ({ ...item, icon: ICONS[item.id] }))}
                  current={shown}
                  onSelect={openSection}
                  label="Sections"
                />
              </div>
            ) : (
              <a
                className="mast-door"
                href={signingIn ? "#sign-in" : "#open-the-door"}
                onClick={focusDoorField}
              >
                {signingIn ? "Sign in" : "Open the door"}
              </a>
            )}
            {server.user ? (
              <button
                type="button"
                className="mast-door"
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
          looks like in use.
          {canClearBoard({ admin, owner: localBoardOwner({ founded, sample }) }) ? (
            <>
              {" "}
              <button
                type="button"
                className="inline-flex min-h-[44px] items-center text-signal underline"
                onClick={() => setSection("about")}
              >
                Clear the sample week…
              </button>{" "}
              when you are ready to use it for real.
            </>
          ) : null}
        </p>
      ) : null}
      {entered && undoClear && undoBar ? (
        <div className="border-b border-line bg-surface" role="status">
          <div className="mx-auto flex w-full max-w-[72rem] flex-wrap items-center justify-between gap-3 px-[clamp(1rem,4vw,4rem)] py-3">
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
      {hero ? <div className="hero-band full" role="img" aria-label={hero} /> : null}
      <div className="shell-body">
        {margin ? <div className="outer-art l" aria-hidden="true" /> : null}
        {margin ? <div className="outer-art r" aria-hidden="true" /> : null}
        <main id="main" tabIndex={-1} aria-busy={busy || undefined}>
          {margin ? (
            <div className="with-side">
              <div className="min-w-0">{page}</div>
              <aside className="side-art" aria-hidden="true" />
            </div>
          ) : (
            page
          )}
        </main>
      </div>
      {entered ? <SessionLine /> : null}
      {entered ? (
        <SectionTabs current={shown} deskOn={deskOn} onSelect={openSection} />
      ) : null}
    </div>
  );
}
