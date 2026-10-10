import { BookOpen, Building2, Phone, Users } from "lucide-react";
import { IconNav, Kicker } from "@/components/quorum/bits";
import { useQuorum } from "@/lib/quorum/store";
import type { View } from "@/lib/quorum/model";
import { CellView } from "@/components/quorum/cell-view";
import { DeskView } from "@/components/quorum/desk-view";
import { DoctrineView } from "@/components/quorum/doctrine-view";
import { LoadView } from "@/components/quorum/load-view";
import { OfficesView } from "@/components/quorum/offices-view";

const NAV = [
  { id: "load", label: "This week's call", icon: Phone },
  { id: "offices", label: "Offices", icon: Building2 },
  { id: "cell", label: "Your people", icon: Users },
  { id: "doctrine", label: "Why one office", icon: BookOpen },
] satisfies { id: View; label: string; icon: typeof Phone }[];

const STEPS = [
  "Pick the one office that can move the bill.",
  "Write the one sentence everyone will say, and set the hour.",
  "Copy the script to your people. They call as themselves.",
  "After you call, log it here. It files in The County as a Did.",
];

/** The Quorum desk, as the engine of The Hall's County room. */
export function QuorumPanel() {
  const view = useQuorum((state) => state.view);
  const setView = useQuorum((state) => state.setView);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Kicker>The desk</Kicker>
        <h1 className="font-display text-4xl text-balance text-fg lg:text-5xl">One office. One sentence. One hour.</h1>
        <p className="max-w-prose text-base text-muted">
          A bill lives or dies at one desk. This page helps your people call that desk, with the same words, in the same hour. It does not dial and it does not pretend a crowd exists. You do the calling.
        </p>
        <ol className="grid max-w-3xl gap-2 text-sm text-muted sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="font-display text-xl leading-none text-signal tabular-nums">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
      <IconNav items={NAV} current={view === "desk" ? "load" : view} onSelect={setView} label="The desk" />
      {view === "load" && <LoadView />}
      {view === "desk" && <DeskView />}
      {view === "doctrine" && <DoctrineView />}
      {view === "offices" && <OfficesView />}
      {view === "cell" && <CellView />}
    </div>
  );
}
