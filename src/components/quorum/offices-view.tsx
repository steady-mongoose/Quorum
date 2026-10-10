import { useState } from "react";
import { ExternalLink, Phone } from "lucide-react";
import { btnGhost, btnSignal, fieldClass, Kicker, LevelSwitch } from "@/components/quorum/bits";
import { officesAt, telHref, type Level } from "@/lib/quorum/model";
import { useQuorum } from "@/lib/quorum/store";

const INTRO: Record<Level, string> = {
  federal:
    "Public lines for the 119th Congress. If the chair you need is missing, use the Capitol switchboard and ask by name.",
  state:
    "Florida capitol desks that can schedule, stall, or veto. Another state is an office you add below — do not invent a number.",
  county:
    "Hillsborough County Commission. The chair controls the agenda. District 4 is the south-county seat, including Wimauma. Another county is an office you add.",
};

export function OfficesView() {
  const aimOffice = useQuorum((state) => state.aimOffice);
  const level = useQuorum((state) => state.level);
  const setLevel = useQuorum((state) => state.setLevel);
  const customOffices = useQuorum((state) => state.customOffices);
  const addOffice = useQuorum((state) => state.addOffice);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const roster = officesAt(level, customOffices);

  function choose(next: Level) {
    setLevel(next);
  }

  function submit() {
    addOffice({ name, role, phone, level });
    setName("");
    setRole("");
    setPhone("");
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Kicker>Offices</Kicker>
        <h2 className="max-w-xl font-display text-3xl text-fg">
          The officials who decide whether a bill moves.
        </h2>
        <p className="max-w-prose text-sm text-muted">A phone book of the handful of people a bill actually depends on, with what each one controls. If the one you need is missing, add it at the bottom.</p>
        <LevelSwitch value={level} onChange={choose} />
        <p className="max-w-2xl text-base text-muted">{INTRO[level]}</p>
      </section>
      <div className="grid gap-4">
        {roster.map((office) => (
          <article key={office.id} className="rounded-lg border border-line bg-surface p-4 sm:p-5">
            <p className="text-xs font-semibold tracking-widest text-signal uppercase">
              {office.role}
            </p>
            <h2 className="mt-2 text-2xl text-fg">
              {office.name}
              {office.party ? (
                <span className="ml-2 font-sans text-sm text-muted">
                  {office.party}-{office.state}
                </span>
              ) : null}
            </h2>
            <p className="mt-3 max-w-3xl text-sm text-muted">{office.holds}</p>
            <p className="mt-3 text-sm text-fg">{office.address}</p>
            {office.phoneNote ? <p className="mt-2 text-sm text-muted">{office.phoneNote}</p> : null}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <a className={btnSignal} href={telHref(office.dcPhone)}>
                <Phone className="size-4" aria-hidden="true" />
                {office.dcPhone}
              </a>
              {office.districtPhone ? (
                <a className={btnGhost} href={telHref(office.districtPhone)}>
                  <Phone className="size-4" aria-hidden="true" />
                  {office.districtLabel} {office.districtPhone}
                </a>
              ) : null}
              <a
                className={btnGhost}
                href={office.contactUrl}
                target="_blank"
                rel="noreferrer"
              >
                Official form
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
              <button
                type="button"
                className={btnGhost}
                onClick={() => aimOffice(office.id, level === "county" ? 40 : level === "state" ? 80 : 150)}
              >
                Aim a desk here
              </button>
            </div>
          </article>
        ))}
      </div>
      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">Add a {level} office</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Use this for a chair who is not listed: your county, your state, a committee. Only a number you have checked on an official page.
        </p>
        <div className="mt-4 grid gap-3">
          <input
            className={fieldClass}
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className={fieldClass}
            placeholder="Role, such as commission chair"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          />
          <input
            className={fieldClass}
            placeholder="Public phone"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <button type="button" className={btnSignal} onClick={submit}>
            Add this office
          </button>
        </div>
      </section>
    </div>
  );
}
