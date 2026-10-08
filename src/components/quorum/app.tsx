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

/**
 * The Quorum desk, as the engine of The Board's Civic room. The Board shell
 * rehydrates this store and provides the outer header; this panel is its own
 * sub-navigation and views.
 */
export function QuorumPanel() {
  const view = useQuorum((state) => state.view);
  const setView = useQuorum((state) => state.setView);
  const current = view === "desk" ? "load" : view;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-widest text-signal uppercase">Civic desk · Quorum</p>
        <p className="text-sm text-muted">
          A surge of constituents. Not a surge of packets. What you log here files as a Did in Civic.
        </p>
      </div>
      <nav className="flex gap-2 overflow-x-auto" aria-label="Quorum">
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
                active ? "bg-signal text-signal-ink" : "border border-line bg-surface text-muted",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </nav>
      {view === "load" && <LoadView />}
      {view === "desk" && <DeskView />}
      {view === "doctrine" && <DoctrineView />}
      {view === "offices" && <OfficesView />}
      {view === "cell" && <CellView />}
    </div>
  );
}
