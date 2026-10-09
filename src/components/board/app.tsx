import { useEffect } from "react";
import { BookOpen, CalendarDays, LayoutList, MessageSquare, Phone, Search, User } from "lucide-react";
import { IconNav } from "@/components/quorum/bits";
import { useBoard } from "@/lib/board/store";
import { useQuorum } from "@/lib/quorum/store";
import { APP_NAME, TAGLINE, type Section } from "@/lib/board/model";
import { AboutView } from "@/components/board/about-view";
import { DmView } from "@/components/board/dm-view";
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
  const theme = themeById(OWNER_THEME);

  useEffect(() => {
    void useBoard.persist.rehydrate();
    void useQuorum.persist.rehydrate();
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-bg text-fg" style={themeVars(theme)}>
      <header className="sticky top-0 z-20 border-b border-line bg-bg">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 pt-4 pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-display text-3xl leading-none text-fg">{APP_NAME}</p>
              <p className="mt-2 text-sm text-muted">{TAGLINE}</p>
            </div>
            <Emblem theme={theme.id} size="header" />
          </div>
          <IconNav
            items={NAV}
            current={section}
            onSelect={(id) => (id === "profile" ? view(me.trim()) : setSection(id))}
            label="Sections"
          />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-24">
        {section === "week" && <WeekView />}
        {section === "rooms" && <RoomView />}
        {section === "find" && <FindView />}
        {section === "civic" && <QuorumPanel />}
        {section === "messages" && <DmView />}
        {section === "profile" && <ProfileView />}
        {section === "about" && <AboutView />}
      </main>
      <SessionLine />
    </div>
  );
}
