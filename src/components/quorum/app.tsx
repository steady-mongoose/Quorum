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
  { do: "Look at this week's calls.", why: "Each one names the official, the phone number, the message, and the hour to call." },
  { do: "When a window is open, dial and read the message.", why: "You call as yourself, from your own phone. The app never dials or sends anything for you." },
  { do: "Then come back and press \"I called.\"", why: "Your call counts toward the group's goal and is posted in The County room." },
  { do: "Organizing one? Press \"Start a call.\"", why: "Choose the official, write the message, set the hour, and copy the script to your group text." },
];

/** The Quorum desk, as the engine of The Hall's County room. */
export function QuorumPanel() {
  const view = useQuorum((state) => state.view);
  const setView = useQuorum((state) => state.setView);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Kicker>The desk</Kicker>
        <h1 className="font-display text-4xl text-balance text-fg lg:text-5xl">Everyone calls one official, at the same time, with the same message.</h1>
        <p className="max-w-prose text-base text-muted">
          Scattered emails to every office get ignored. What staff notice is a hundred calls to the one official whose desk a bill is sitting on, in one morning, all asking for the same thing. This page tells you who that official is, what to say, when to call, and lets you record that you called.
        </p>
        <ol className="grid max-w-4xl list-none gap-3 p-0 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li key={step.do} className="flex gap-3">
              <span className="font-display text-2xl leading-none text-signal tabular-nums">{index + 1}</span>
              <span className="flex flex-col gap-1 text-sm">
                <span className="font-semibold text-fg">{step.do}</span>
                <span className="text-muted">{step.why}</span>
              </span>
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
