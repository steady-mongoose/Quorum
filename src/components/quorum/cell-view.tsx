import { useState } from "react";
import { Copy, Check, Trash2 } from "lucide-react";
import { btnGhost, btnSignal, fieldClass, Kicker, useCopy } from "@/components/quorum/bits";
import { officeById, phoneTree } from "@/lib/quorum/model";
import { useQuorum } from "@/lib/quorum/store";

export function CellView() {
  const cell = useQuorum((state) => state.cell);
  const profile = useQuorum((state) => state.profile);
  const campaigns = useQuorum((state) => state.campaigns);
  const setProfile = useQuorum((state) => state.setProfile);
  const addMember = useQuorum((state) => state.addMember);
  const removeMember = useQuorum((state) => state.removeMember);
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [deskId, setDeskId] = useState(campaigns[0]?.id ?? "");
  const { copied, copy } = useCopy();

  const campaign = campaigns.find((item) => item.id === deskId) ?? campaigns[0];

  function submitMember() {
    addMember(name, place);
    setName("");
    setPlace("");
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Kicker>Step 3 · Your people</Kicker>
        <h2 className="max-w-xl font-display text-3xl text-fg">
          The people you will text the script to.
        </h2>
        <p className="max-w-prose text-base text-muted">
          Add the people you can reach yourself: a group text, a congregation, a precinct. This list never leaves this device. At the bottom, copy the script and paste it into the group you already use.
        </p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">On the call, you are</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-muted">
            Name you will give the staffer
            <input
              className={fieldClass}
              value={profile.name}
              placeholder="Your name"
              onChange={(event) => setProfile({ name: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted">
            City and state
            <input
              className={fieldClass}
              value={profile.place}
              placeholder="City, State"
              onChange={(event) => setProfile({ place: event.target.value })}
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">The cell</h2>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            className={fieldClass}
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className={fieldClass}
            placeholder="City"
            value={place}
            onChange={(event) => setPlace(event.target.value)}
          />
          <button type="button" className={btnSignal} onClick={submitMember}>
            Add
          </button>
        </div>
        {cell.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No one else yet. Start with three people who will dial in the same
            window and reply when it is done.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {cell.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg px-3 py-2"
              >
                <span className="text-sm text-fg">
                  {member.name}
                  {member.place ? <span className="text-muted"> · {member.place}</span> : null}
                </span>
                <button
                  type="button"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted"
                  aria-label={`Remove ${member.name}`}
                  onClick={() => removeMember(member.id)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {campaign ? (
        <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
          <h2 className="text-2xl text-fg">Send the tree</h2>
          <label className="mt-4 flex flex-col gap-2 text-sm text-muted">
            Which desk
            <select
              className="min-h-11 rounded-md border border-line bg-raised px-3 text-base text-fg"
              value={campaign.id}
              onChange={(event) => setDeskId(event.target.value)}
            >
              {campaigns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-3 text-sm text-muted">
            {officeById(campaign.officeId).name} · {cell.length + 1} people if
            everyone on this list dials, including you.
          </p>
          <button
            type="button"
            className={btnGhost + " mt-4"}
            onClick={() =>
              copy(
                "tree",
                phoneTree(campaign, officeById(campaign.officeId), profile),
              )
            }
          >
            {copied === "tree" ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied === "tree" ? "Copied" : "Copy phone tree"}
          </button>
        </section>
      ) : null}
    </div>
  );
}
