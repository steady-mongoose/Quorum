import { useEffect } from "react";
import { BookOpen, CalendarDays, LayoutList, MessageSquare, Phone } from "lucide-react";
import { cn } from "@/lib/cn";
import { useBoard } from "@/lib/board/store";
import { useQuorum } from "@/lib/quorum/store";
import type { Section } from "@/lib/board/model";
import { AboutView } from "@/components/board/about-view";
import { DmView } from "@/components/board/dm-view";
import { FindView } from "@/components/board/find-view";
import { RoomView } from "@/components/board/room-view";
import { SessionLine } from "@/components/board/line";
import { QuorumPanel } from "@/components/quorum/app";

const NAV: { id: Section; label: string; icon: typeof LayoutList }[] = [
  { id: "rooms", label: "Rooms", icon: LayoutList },
  { id: "find", label: "Find", icon: CalendarDays },
  { id: "civic", label: "Civic desk", icon: Phone },
  { id: "messages", label: "Messages", icon: MessageSquare },
  { id: "about", label: "About", icon: BookOpen },
];

export function BoardApp() {
  const section = useBoard((state) => state.section);
  const setSection = useBoard((state) => state.setSection);

  useEffect(() => {
    void useBoard.persist.rehydrate();
    void useQuorum.persist.rehydrate();
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg">
        <div className="mx-auto flex w-full max-w-5xl items-end justify-between gap-4 px-4 pt-4 pb-3">
          <div>
            <p className="font-display text-3xl leading-none text-fg">The Board</p>
            <p className="mt-2 text-sm text-muted">Read your room. Then leave.</p>
          </div>
        </div>
        <nav className="mx-auto flex w-full max-w-5xl gap-2 overflow-x-auto px-4 pb-3" aria-label="Sections">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setSection(item.id)}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold",
                  active ? "bg-signal text-signal-ink" : "bg-surface text-muted",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>
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
