import { BookOpen, Building2, Radio, Users } from "lucide-react";
import { IconNav, Kicker } from "@/components/quorum/bits";
import { useQuorum } from "@/lib/quorum/store";
import type { View } from "@/lib/quorum/model";
import { CellView } from "@/components/quorum/cell-view";
import { DeskView } from "@/components/quorum/desk-view";
import { DoctrineView } from "@/components/quorum/doctrine-view";
import { LoadView } from "@/components/quorum/load-view";
import { OfficesView } from "@/components/quorum/offices-view";

const NAV = [
  { id: "load", label: "Load", icon: Radio },
  { id: "doctrine", label: "Doctrine", icon: BookOpen },
  { id: "offices", label: "Offices", icon: Building2 },
  { id: "cell", label: "Cell", icon: Users },
] satisfies { id: View; label: string; icon: typeof Radio }[];

/** The Quorum desk, as the engine of The Board's Civic room. */
export function QuorumPanel() {
  const view = useQuorum((state) => state.view);
  const setView = useQuorum((state) => state.setView);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Kicker>Civic desk · Quorum</Kicker>
        <p className="text-sm text-muted">
          A surge of constituents. Not a surge of packets. What you log here files as a Did in Civic.
        </p>
      </div>
      <IconNav items={NAV} current={view === "desk" ? "load" : view} onSelect={setView} label="Quorum" />
      {view === "load" && <LoadView />}
      {view === "desk" && <DeskView />}
      {view === "doctrine" && <DoctrineView />}
      {view === "offices" && <OfficesView />}
      {view === "cell" && <CellView />}
    </div>
  );
}
