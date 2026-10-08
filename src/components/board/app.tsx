import { useEffect } from "react";
import { BookOpen, CalendarDays, LayoutList, MessageSquare, Phone } from "lucide-react";
import { IconNav } from "@/components/quorum/bits";
import { useBoard } from "@/lib/board/store";
import { useQuorum } from "@/lib/quorum/store";
import type { Section } from "@/lib/board/model";
import { AboutView } from "@/components/board/about-view";
import { DmView } from "@/components/board/dm-view";
import { FindView } from "@/components/board/find-view";
import { RoomView } from "@/components/board/room-view";
import { SessionLine } from "@/components/board/line";
import { QuorumPanel } from "@/components/quorum/app";
import { Emblem } from "@/components/board/emblem";
import { themeById, themeVars } from "@/lib/board/themes";

const NAV = [
  { id: "rooms", label: "Rooms", icon: LayoutList },
  { id: "find", label: "Find", icon: CalendarDays },
  { id: "civic", label: "Civic desk", icon: Phone },
  { id: "messages", label: "Messages", icon: MessageSquare },
  { id: "about", label: "About", icon: BookOpen },
] satisfies { id: Section; label: string; icon: typeof LayoutList }[];

export function BoardApp() {
  const section = useBoard((state) => state.section);
  const setSection = useBoard((state) => state.setSection);
  const theme = useBoard((state) => themeById(state.theme));

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
              <p className="font-display text-3xl leading-none text-fg">The Board</p>
              <p className="mt-2 text-sm text-muted">{theme.motto || "Read your room. Then leave."}</p>
            </div>
            <Emblem theme={theme.id} size="header" />
          </div>
          <IconNav items={NAV} current={section} onSelect={setSection} label="Sections" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-24">
        {section === "rooms" && <RoomView />}
        {section === "find" && <FindView />}
        {section === "civic" && <QuorumPanel />}
        {section === "messages" && <DmView />}
        {section === "about" && <AboutView />}
      </main>
      <SessionLine />
    </div>
  );
}
