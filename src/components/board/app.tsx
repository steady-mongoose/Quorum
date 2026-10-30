import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CallRings, focusRoomCall } from "@/components/board/call-rings";
import {
  BookOpen,
  CalendarDays,
  LayoutList,
  MessageSquare,
  Users,
  Phone,
  Search,
  User,
} from "lucide-react";
import { btnGhost, btnQuiet, btnSignal, IconNav } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { userFacingError } from "@/lib/board/errors";
import {
  UNDO_BAR_MS,
  UNDO_TTL_MS,
  canClearBoard,
  keepsRoomsPage,
  localBoardOwner,
  useBoard,
} from "@/lib/board/store";
import { useQuorum } from "@/lib/quorum/store";
import { APP_NAME, TAGLINE, type Section } from "@/lib/board/model";
import { AboutView } from "@/components/board/about-view";
import { watchInviteHash } from "@/lib/board/invite-hash";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { DM_SIGNOUT_HISTORY_WARNING } from "@/lib/e2ee/copy";
import { browserVaultStore } from "@/lib/e2ee/browser";
import { signOutClearsReadHistory } from "@/lib/e2ee/read-history";
import { GroupsView } from "@/components/board/groups-view";
import { DmView } from "@/components/board/dm-view";
import { Door } from "@/components/board/door";
import { AgeStep } from "@/components/board/age-step";
import { FindView } from "@/components/board/find-view";
import { ProfileView } from "@/components/board/profile-view";
import { RoomView } from "@/components/board/room-view";
import { RoomsRouteProvider } from "@/components/board/rooms-route";
import { SectionTabs } from "@/components/board/section-tabs";
import { SessionLine } from "@/components/board/line";
import { WeekView } from "@/components/board/week-view";
import { QuorumPanel } from "@/components/quorum/app";
import { DesktopMore } from "@/components/board/desktop-more";
import { AppealMark } from "@/components/board/emblem";
import { PrimaryHaptic } from "@/components/board/haptics";
import { desktopNav } from "@/lib/board/phone-nav";
import { OWNER_THEME, themeById, themeVars } from "@/lib/board/themes";
import { ServerSessionProvider } from "@/lib/server-session";
import { useServerSession } from "@/lib/server-session-state";
import { artSection, heroLabel, showsHero } from "@/lib/board/engraved";
import { useEngravedDocument } from "@/components/board/engraved-ground";
import { useMastHeight } from "@/lib/board/mast-height";

const ICONS = {
  week: CalendarDays,
  rooms: LayoutList,
  groups: Users,
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

export function BoardApp({ categorySlug }: { categorySlug?: string | null } = {}) {
  const route = categorySlug === undefined ? null : { slug: categorySlug };
  return (
    <ServerSessionProvider>
      <RoomsRouteProvider value={route}>
        <BoardShell categorySlug={categorySlug} />
      </RoomsRouteProvider>
    </ServerSessionProvider>
  );
}

function BoardShell({ categorySlug }: { categorySlug?: string | null }) {
  const section = useBoard((state) => state.section);
  const setSection = useBoard((state) => state.setSection);
  const setRoom = useBoard((state) => state.setRoom);
  const navigate = useNavigate();
  const onRoomsRoute = categorySlug !== undefined;
  const deskOn = useBoard((state) => state.deskOn);
  const view = useBoard((state) => state.view);
  const me = useBoard((state) => state.me);
  const member = useBoard((state) => state.member);
  const localEntry = useBoard((state) => state.localEntry);
  const undoClear = useBoard((state) => state.undoClear);
  const undoClearBoard = useBoard((state) => state.undoClearBoard);
  const boardError = useBoard((state) => state.boardError);
  const ownAppeals = useBoard((state) => state.appeals);
  const undoButton = useRef<HTMLButtonElement>(null);
  const [undoBar, setUndoBar] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [boardLoading, setBoardLoading] = useState(false);
  const server = useServerSession();
  const theme = themeById(OWNER_THEME);
  const waiting = server.mode === "pending";
  // A member whose account predates the 18+ check confirms once before the app.
  const ageDue = server.mode === "live" && Boolean(server.user) && !server.ageConfirmed;
  const entered = !ageDue && (server.mode === "live" ? Boolean(server.user) || localEntry : member);
  const apiDown = server.configured && server.mode === "demo";
  const signingIn = !entered && (server.mode === "live" || apiDown);
  const busy = waiting || boardLoading;
  const categoryPage = typeof categorySlug === "string" && categorySlug.length > 0;
  // A conversation opened from a member list shows on the rooms page itself, so
  // the address stays /rooms (or /rooms/<category>) and Back returns to the room.
  const memberConversation = useBoard(keepsRoomsPage) && section === "messages";
  const shown =
    onRoomsRoute && !memberConversation
      ? "rooms"
      : section === "civic" && !deskOn
        ? "week"
        : section;
  const art = artSection({
    entered,
    section: shown,
    signingIn,
  });
  const hero = heroLabel(art);
  const margin = showsHero(art);
  useEngravedDocument(art);
  // The Rooms chip row and anchor scrolling sit flush under the sticky header at its real height.
  useMastHeight();

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
    if (server.mode !== "live" || !server.user || !server.ageConfirmed) return;
    const name = server.user.name.trim();
    if (!name) return;
    const next = useBoard.getState();
    if (next.me !== name || !next.member) {
      useBoard.setState({ member: true, me: name });
    }
    let cancel = false;
    setBoardLoading(true);
    void useBoard
      .getState()
      .connectRemote()
      .finally(() => {
        if (!cancel) setBoardLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [server.mode, server.user, server.ageConfirmed]);

  // /#invite (Find's invite link, a shared link, or back/forward) opens About at
  // the invite section. ServerInvite then focuses its heading.
  useEffect(() => {
    if (typeof window === "undefined") return;
    return watchInviteHash(window, () => setSection("about"));
  }, [setSection]);

  useEffect(() => {
    if (!deskOn && section === "civic") setSection("week");
  }, [deskOn, section, setSection]);

  useEffect(() => {
    if (categorySlug === undefined) return;
    setSection("rooms");
  }, [categorySlug, setSection]);

  // A rooms page shows Rooms, or a conversation opened from a room's member
  // list. When an action elsewhere moves the board (open a profile, all
  // messages), leave the rooms page so it shows.
  useEffect(() => {
    if (!onRoomsRoute) return;
    return useBoard.subscribe((state, previous) => {
      if (keepsRoomsPage(state)) return;
      if (state.section !== previous.section || keepsRoomsPage(previous)) {
        void navigate({ to: "/" });
      }
    });
  }, [onRoomsRoute, navigate]);

  const openSection = (id: Section) => {
    if (id === "profile") {
      view(me.trim());
      if (onRoomsRoute) void navigate({ to: "/" });
      return;
    }
    if (id === "rooms") {
      setSection("rooms");
      void navigate({ to: "/rooms" });
      return;
    }
    setSection(id);
    if (onRoomsRoute) void navigate({ to: "/" });
  };

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
      {entered && server.mfa === "enroll" ? (
        <div className="mfa-banner mb-4 flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-prose text-sm text-fg">
            Turn on an authenticator before you moderate, grant a role, approve a reset, or export.
          </p>
          <button
            type="button"
            className={cn(btnSignal, "w-full sm:w-auto")}
            onClick={() => openSection("profile")}
          >
            Set it up
          </button>
        </div>
      ) : null}
      {ageDue ? <AgeStep /> : null}
      {!entered && !ageDue && <Door />}
      {entered && shown === "week" && <WeekView />}
      {entered && shown === "rooms" && <RoomView />}
      {entered && shown === "groups" && <GroupsView />}
      {entered && shown === "find" && <FindView />}
      {entered && shown === "civic" && deskOn && <QuorumPanel />}
      {entered && shown === "messages" && <DmView />}
      {entered && shown === "profile" && <ProfileView />}
      {entered && shown === "about" && <AboutView onSetUp={() => openSection("profile")} />}
    </>
  );

  return (
    <div className="shell min-h-dvh overflow-x-clip text-fg" style={themeVars(theme)}>
      {/* First in the Tab order, so an incoming call is one Tab away. */}
      {entered ? (
        <CallRings
          onGo={(roomId) => {
            setSection("rooms");
            setRoom(roomId as Parameters<typeof setRoom>[0]);
            void navigate({ to: "/rooms" }).then(() =>
              requestAnimationFrame(() =>
                focusRoomCall(1000, Date.now(), document.activeElement, true),
              ),
            );
          }}
        />
      ) : null}
      <a
        href="#main"
        className="skip-link sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-md focus:bg-signal focus:px-4 focus:text-sm focus:font-semibold focus:text-signal-ink"
      >
        Skip to content
      </a>
      <PrimaryHaptic />
      {art === "landing" || art === "signin" ? (
        <div className="plate-ground" aria-hidden="true" />
      ) : null}
      {art === "landing" || art === "signin" ? <div className="scrim" aria-hidden="true" /> : null}
      <header className="top mast-bar">
        <div className="mast" data-entered={entered ? "true" : undefined}>
          <div className="mast-brand">
            <AppealMark />
            <div className="mast-titles">
              <p className="mast-name">{APP_NAME}</p>
              <p className={cn("mast-tagline", entered && "max-xl:hidden xl:whitespace-nowrap")}>
                {TAGLINE}
              </p>
            </div>
          </div>
          <div className="mast-actions">
            {entered ? (
              <div className="topnav">
                <IconNav
                  className="flex-nowrap gap-1"
                  itemClassName="max-[1099px]:gap-1 max-[1099px]:px-2"
                  iconClassName="max-[1099px]:hidden"
                  items={desktopNav(deskOn).map((item) => ({ ...item, icon: ICONS[item.id] }))}
                  current={shown}
                  onSelect={openSection}
                  label="Sections"
                >
                  <DesktopMore
                    current={shown}
                    deskOn={deskOn}
                    onSelect={openSection}
                    itemClassName="max-[1099px]:gap-1 max-[1099px]:px-2"
                    iconClassName="max-[1099px]:hidden"
                  />
                </IconNav>
              </div>
            ) : ageDue ? null : (
              <a
                className="mast-door"
                href={signingIn ? "#sign-in" : "#open-the-door"}
                onClick={focusDoorField}
              >
                {signingIn ? "Sign in" : "Enter your invite code"}
              </a>
            )}
            {server.user ? (
              <button
                type="button"
                className="mast-door"
                onClick={() => {
                  const leave = () => {
                    setConfirmSignOut(false);
                    void server.signOut().finally(() => {
                      useBoard.getState().disconnectRemote();
                    });
                  };
                  if (signOutClearsReadHistory(browserVaultStore().read())) {
                    setConfirmSignOut(true);
                    return;
                  }
                  leave();
                }}
              >
                Sign out
              </button>
            ) : null}
          </div>
        </div>
      </header>
      {boardError && shown !== "find" ? (
        <div
          role="alert"
          className="border-b border-signal bg-surface px-[clamp(1rem,4vw,4rem)] py-2 text-sm text-signal"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              {userFacingError(
                boardError,
                "That did not go through. Please try again in a moment.",
              )}
            </p>
            <button
              type="button"
              className={cn(btnQuiet, "min-h-[44px]")}
              onClick={() => useBoard.setState({ boardError: "", failedRemovalNames: [] })}
            >
              Dismiss
            </button>
          </div>
          {boardError === "This account is barred from the board." && ownAppeals.length > 0 ? (
            <ul className="mt-1 text-muted">
              {ownAppeals.map((row) => (
                <li key={row.id}>
                  Your {row.kind} appeal is{" "}
                  {row.decision === "lift"
                    ? "lifted"
                    : row.decision === "uphold"
                      ? "upheld"
                      : "open"}
                  .
                </li>
              ))}
            </ul>
          ) : null}
        </div>
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
      {hero && !categoryPage ? (
        <div className="hero-band full" role="img" aria-label={hero} />
      ) : null}
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
      {entered ? <SectionTabs current={shown} deskOn={deskOn} onSelect={openSection} /> : null}
      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out"
        description={DM_SIGNOUT_HISTORY_WARNING}
        confirmLabel="Sign out and clear"
        cancelLabel="Stay signed in"
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          void server.signOut().finally(() => {
            useBoard.getState().disconnectRemote();
          });
        }}
      />
    </div>
  );
}
