import { useEffect } from "react";
import { BookOpen, CalendarDays, LayoutList, MessageSquare, Phone, Search, User } from "lucide-react";
import { IconNav } from "@/components/quorum/bits";
import { useBoard } from "@/lib/board/store";
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
  const section = useBoard((state) => state.section);
  const setSection = useBoard((state) => state.setSection);
  const view = useBoard((state) => state.view);
  const me = useBoard((state) => state.me);
  const member = useBoard((state) => state.member);
  const sample = useBoard((state) => state.sample);
  const theme = themeById(OWNER_THEME);

  useEffect(() => {
    void useBoard.persist.rehydrate();
    void useQuorum.persist.rehydrate();
  }, []);

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
          {member ? (
            <IconNav
              items={NAV}
              current={section}
              onSelect={(id) => (id === "profile" ? view(me.trim()) : setSection(id))}
              label="Sections"
            />
          ) : null}
        </div>
      </header>
      {member && sample ? (
        <p className="border-b border-signal bg-surface px-[clamp(1rem,4vw,4rem)] py-2 text-sm text-muted">
          <span className="font-semibold text-signal">Sample week.</span> Everyone here (Josh, Tom, Dale, Maria, Luis, Ruth) and everything they wrote is invented, to show what the app looks like in use.{" "}
          <button type="button" className="text-signal underline" onClick={() => setSection("about")}>
            Clear it under About
          </button>{" "}
          when you are ready to use it for real.
        </p>
      ) : null}
      <main className="mx-auto w-full max-w-[100rem] px-[clamp(1rem,4vw,4rem)] pt-6 pb-24">
        {!member && <Door />}
        {member && section === "week" && <WeekView />}
        {member && section === "rooms" && <RoomView />}
        {member && section === "find" && <FindView />}
        {member && section === "civic" && <QuorumPanel />}
        {member && section === "messages" && <DmView />}
        {member && section === "profile" && <ProfileView />}
        {member && section === "about" && <AboutView />}
      </main>
      {member ? <SessionLine /> : null}
    </div>
  );
}
