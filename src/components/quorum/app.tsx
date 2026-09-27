import { useEffect } from "react";
import { BookOpen, Building2, Radio, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useQuorum } from "@/lib/quorum/store";
import type { View } from "@/lib/quorum/model";
import { CellView } from "@/components/quorum/cell-view";
import { DeskView } from "@/components/quorum/desk-view";
import { DoctrineView } from "@/components/quorum/doctrine-view";
import { LoadView } from "@/components/quorum/load-view";
import { OfficesView } from "@/components/quorum/offices-view";

const NAV: { id: View; label: string; icon: typeof Radio }[] = [
  { id: "load", label: "Load", icon: Radio },
  { id: "doctrine", label: "Doctrine", icon: BookOpen },
  { id: "offices", label: "Offices", icon: Building2 },
  { id: "cell", label: "Cell", icon: Users },
];

export function QuorumApp() {
  const view = useQuorum((state) => state.view);
  const setView = useQuorum((state) => state.setView);

  useEffect(() => {
    void useQuorum.persist.rehydrate();
  }, []);

  const current = view === "desk" ? "load" : view;

  return (
    <div className="min-h-screen overflow-x-hidden bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg">
        <div className="mx-auto flex w-full max-w-5xl items-end justify-between gap-4 px-4 pt-4 pb-3">
          <div>
            <p className="font-display text-3xl leading-none text-fg">Quorum</p>
            <p className="mt-2 text-sm text-muted">
              A surge of constituents. Not a surge of packets.
            </p>
          </div>
        </div>
        <nav className="mx-auto flex w-full max-w-5xl gap-2 overflow-x-auto px-4 pb-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = current === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setView(item.id)}
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
      <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-16">
        {view === "load" && <LoadView />}
        {view === "desk" && <DeskView />}
        {view === "doctrine" && <DoctrineView />}
        {view === "offices" && <OfficesView />}
        {view === "cell" && <CellView />}
      </main>
    </div>
  );
}
