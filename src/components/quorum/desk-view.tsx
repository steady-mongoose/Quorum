import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Phone,
  Trash2,
} from "lucide-react";
import {
  btnGhost,
  btnQuiet,
  btnSignal,
  fieldClass,
  Kicker,
  Meter,
  useCopy,
  useNow,
} from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  callScript,
  CHANNELS,
  channelBody,
  formatWindow,
  letterBody,
  livesInOfficeState,
  officeById,
  outsideNote,
  phoneTree,
  smsPing,
  telHref,
  wavesFor,
  weaselHit,
  windowKind,
  windowStatus,
  type Channel,
  type Posture,
} from "@/lib/quorum/model";
import { useQuorum } from "@/lib/quorum/store";

function formatWhen(at: number, now: number): string {
  const delta = Math.max(0, now - at);
  const mins = Math.round(delta / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(at).toLocaleDateString();
}

export function DeskView() {
  const selectedId = useQuorum((state) => state.selectedId);
  const campaign = useQuorum((state) =>
    state.campaigns.find((item) => item.id === selectedId),
  );
  const logs = useQuorum((state) => state.logs);
  const cell = useQuorum((state) => state.cell);
  const profile = useQuorum((state) => state.profile);
  const customOffices = useQuorum((state) => state.customOffices);
  const setView = useQuorum((state) => state.setView);
  const updateCampaign = useQuorum((state) => state.updateCampaign);
  const removeCampaign = useQuorum((state) => state.removeCampaign);
  const logContact = useQuorum((state) => state.logContact);
  const clearLog = useQuorum((state) => state.clearLog);
  const allies = useQuorum((state) => state.allies);
  const addAlly = useQuorum((state) => state.addAlly);
  const removeAlly = useQuorum((state) => state.removeAlly);
  const now = useNow();
  const { copied, copy } = useCopy();
  const [who, setWho] = useState("You");
  const [revising, setRevising] = useState(false);
  const [refuseDraft, setRefuseDraft] = useState("");
  const [channel, setChannel] = useState<Channel>("signal");
  const [allyName, setAllyName] = useState("");
  const [allyCount, setAllyCount] = useState("25");
  const [allyChannel, setAllyChannel] = useState("Signal");

  const entries = useMemo(
    () => (campaign ? logs.filter((entry) => entry.campaignId === campaign.id) : []),
    [logs, campaign],
  );

  if (!campaign) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl text-fg">That desk is gone.</h1>
        <button type="button" className={btnGhost} onClick={() => setView("load")}>
          Back to the load
        </button>
      </div>
    );
  }

  const office = officeById(campaign.officeId, customOffices);
  const waves = wavesFor(office.level);
  const beam = allies.filter((ally) => ally.campaignId === campaign.id);
  const pledged = beam.reduce((sum, ally) => sum + ally.pledged, 0);
  const paste = channelBody(channel, campaign, office, profile);
  const channelMeta = CHANNELS.find((item) => item.id === channel) ?? CHANNELS[0];
  const script = callScript(campaign, office, profile);
  const letter = letterBody(campaign, office, profile);
  const tree = phoneTree(campaign, office, profile);
  const status = now ? windowStatus(campaign.surgeStart, campaign.surgeEnd, now) : null;
  const home = livesInOfficeState(office, profile.place);
  const quota = weaselHit(campaign.demand);
  const showRevise = revising || !campaign.demand.trim();
  const clock = now ? now.getTime() : 0;

  const desk = campaign;

  const setPosture = (posture: Posture) => {
    updateCampaign(desk.id, { posture });
  };

  const addRefuse = () => {
    const next = refuseDraft.trim();
    if (!next) return;
    updateCampaign(desk.id, { refuses: [...desk.refuses, next] });
    setRefuseDraft("");
  };

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        className={cn(btnQuiet, "self-start px-0")}
        onClick={() => setView("load")}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All desks
      </button>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              campaign.posture === "absolute"
                ? "rounded-sm bg-signal px-2 py-1 text-xs font-semibold text-signal-ink"
                : "rounded-sm border border-line px-2 py-1 text-xs font-semibold text-muted"
            }
          >
            {campaign.posture === "absolute" ? "Absolute standard" : "Partial bill"}
          </span>
          {status?.live ? (
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-signal">
              <span className="live-dot size-2 rounded-full bg-signal" />
              {status.label}
            </span>
          ) : (
            <span className="text-sm text-muted">
              {formatWindow(campaign.surgeStart, campaign.surgeEnd)}
              {status ? ` · ${status.label}` : ""}
            </span>
          )}
        </div>
        <h1 className="text-4xl text-fg">{campaign.title}</h1>
        <p className="max-w-2xl text-base text-muted">{campaign.principle}</p>
      </header>

      {campaign.posture === "partial" ? (
        <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-fg">
          This desk accepts a partial statute. Whatever you pass will tutor the
          public that the compromise is the baseline. Hold that only if the cell
          has decided the teaching is worth it.
        </p>
      ) : null}
      {quota ? (
        <p className="rounded-md border border-signal bg-surface px-4 py-3 text-sm text-fg">
          The demand reads like a cap, a phase-in, or a licensed exception. That
          is a quota. Rewrite it before the window, or the office will count you
          for the weaker bill.
        </p>
      ) : null}

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <Kicker>The sentence</Kicker>
        <p className="mt-3 text-lg text-fg">
          {campaign.demand.trim() || "Write the one demand this whole cell will say."}
        </p>
        {campaign.refuses.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2">
            {campaign.refuses.map((item) => (
              <li key={item} className="text-sm text-muted">
                Will not accept — {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted">
            Name the carve-outs you refuse. A bill with none listed will grow them
            in committee.
          </p>
        )}
        {campaign.demand.trim() ? (
          <button
            type="button"
            className={cn(btnGhost, "mt-4")}
            onClick={() => setRevising((open) => !open)}
          >
            {revising ? "Hide the draft" : "Revise the demand"}
          </button>
        ) : null}
        {showRevise ? (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-2 text-sm text-muted">
              Desk title
              <input
                className={fieldClass}
                value={campaign.title}
                onChange={(event) =>
                  updateCampaign(campaign.id, { title: event.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              The demand, one sentence
              <textarea
                className={fieldClass + " min-h-28"}
                value={campaign.demand}
                onChange={(event) =>
                  updateCampaign(campaign.id, { demand: event.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Why a partial bill fails
              <textarea
                className={fieldClass + " min-h-20"}
                value={campaign.principle}
                onChange={(event) =>
                  updateCampaign(campaign.id, { principle: event.target.value })
                }
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={campaign.posture === "absolute" ? btnSignal : btnGhost}
                onClick={() => setPosture("absolute")}
                aria-pressed={campaign.posture === "absolute"}
              >
                Absolute
              </button>
              <button
                type="button"
                className={campaign.posture === "partial" ? btnSignal : btnGhost}
                onClick={() => setPosture("partial")}
                aria-pressed={campaign.posture === "partial"}
              >
                Partial
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-muted">
                Quorum
                <input
                  className={fieldClass}
                  type="number"
                  min={20}
                  max={5000}
                  value={campaign.threshold}
                  onChange={(event) =>
                    updateCampaign(campaign.id, {
                      threshold: Math.max(20, Number(event.target.value) || 20),
                    })
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Window opens (24h)
                <input
                  className={fieldClass}
                  type="time"
                  value={minutesToTime(campaign.surgeStart)}
                  onChange={(event) =>
                    updateCampaign(campaign.id, {
                      surgeStart: timeToMinutes(event.target.value),
                    })
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Window closes
                <input
                  className={fieldClass}
                  type="time"
                  value={minutesToTime(campaign.surgeEnd)}
                  onChange={(event) =>
                    updateCampaign(campaign.id, {
                      surgeEnd: timeToMinutes(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className={fieldClass}
                placeholder="A carve-out you will not trade"
                value={refuseDraft}
                onChange={(event) => setRefuseDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addRefuse();
                  }
                }}
              />
              <button type="button" className={btnGhost} onClick={addRefuse}>
                Add refusal
              </button>
            </div>
            {campaign.refuses.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {campaign.refuses.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="min-h-11 rounded-md border border-line px-3 text-sm text-muted"
                    onClick={() =>
                      updateCampaign(campaign.id, {
                        refuses: campaign.refuses.filter((entry) => entry !== item),
                      })
                    }
                  >
                    Remove {item}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-signal bg-surface p-4 sm:p-5">
        <Kicker>The office</Kicker>
        <h2 className="mt-2 text-3xl text-fg">{office.name}</h2>
        <p className="text-sm text-muted">{office.role}</p>
        <p className="mt-3 max-w-2xl text-sm text-fg">{office.holds}</p>
        <p className="mt-3 text-sm text-muted">{windowKind(campaign.surgeStart)}</p>
        {!home ? (
          <p className="mt-3 text-sm text-muted">{outsideNote(office, profile.place)}</p>
        ) : null}
        {office.phoneNote ? <p className="mt-3 text-sm text-fg">{office.phoneNote}</p> : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <a className={btnSignal} href={telHref(office.dcPhone)}>
            <Phone className="size-4" aria-hidden="true" />
            Call {office.dcPhone}
          </a>
          {office.districtPhone ? (
            <a className={btnGhost} href={telHref(office.districtPhone)}>
              <Phone className="size-4" aria-hidden="true" />
              {office.districtLabel} {office.districtPhone}
            </a>
          ) : office.level === "county" ? null : (
            <p className="self-center text-sm text-muted">
              {office.level === "state"
                ? "Ask that desk for the district office, then call it the same day."
                : "Ask the DC desk for the district number, then call it the same day."}
            </p>
          )}
          <a className={btnGhost} href={office.contactUrl} target="_blank" rel="noreferrer">
            Official form
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <Kicker>Same sentence</Kicker>
        <p className="mt-2 text-sm text-muted">
          Staff count a surge when every caller says the same thing. Read this.
          Do not freelance a softer ask.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-line bg-bg p-4 text-sm whitespace-pre-wrap text-fg">
          {script}
        </pre>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button type="button" className={btnGhost} onClick={() => copy("script", script)}>
            {copied === "script" ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied === "script" ? "Copied" : "Copy the script"}
          </button>
          <button type="button" className={btnGhost} onClick={() => copy("letter", letter)}>
            {copied === "letter" ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied === "letter" ? "Copied" : "Copy the letter"}
          </button>
          <button type="button" className={btnGhost} onClick={() => copy("tree", tree)}>
            {copied === "tree" ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied === "tree" ? "Copied" : "Copy the phone tree"}
          </button>
        </div>
        <p className="sr-only" aria-live="polite">
          {copied ? "Copied to clipboard" : ""}
        </p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <Kicker>Send it</Kicker>
        <h2 className="mt-2 text-3xl text-fg">One paste. No rewrite.</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          The platform only matters if the sentence stays intact. Pick where you are sending it.
        </p>
        <div className="mt-4 flex gap-2 overflow-x-auto" role="tablist" aria-label="Where to send">
          {CHANNELS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={channel === item.id}
              onClick={() => setChannel(item.id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-semibold",
                channel === item.id ? "bg-signal text-signal-ink" : "border border-line text-muted",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-fg">{channelMeta.hint}</p>
        {channel === "post" ? (
          <article className="mt-4 rounded-lg border border-signal bg-bg p-5">
            <p className="text-xs font-semibold tracking-widest text-signal uppercase">Quorum</p>
            <h3 className="mt-3 font-display text-3xl text-fg">{office.name}</h3>
            <p className="text-sm text-muted">{office.role}</p>
            <p className="mt-4 font-display text-4xl text-fg">{office.dcPhone}</p>
            <p className="mt-2 text-sm text-muted">{formatWindow(campaign.surgeStart, campaign.surgeEnd)}</p>
            <p className="mt-4 max-w-xl text-base text-fg">
              {campaign.demand.trim() || "A hearing and a recorded vote on the unamended bill."}
            </p>
            <p className="mt-4 text-sm text-muted">Same words. Same hour. Call as yourself.</p>
          </article>
        ) : null}
        <pre className="mt-4 overflow-x-auto rounded-md border border-line bg-bg p-4 text-sm whitespace-pre-wrap text-fg">
          {paste}
        </pre>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {channel === "sms" ? (
            <>
              <button type="button" className={btnSignal} onClick={() => copy("ping", smsPing(campaign, office))}>
                {copied === "ping" ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied === "ping" ? "Copied" : "Copy the ping"}
              </button>
              <button type="button" className={btnGhost} onClick={() => copy("sms-script", callScript(campaign, office, profile, true))}>
                {copied === "sms-script" ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied === "sms-script" ? "Copied" : "Copy the second text"}
              </button>
            </>
          ) : (
            <button type="button" className={btnSignal} onClick={() => copy(channel, paste)}>
              {copied === channel ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied === channel ? "Copied" : `Copy for ${channelMeta.label}`}
            </button>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-signal bg-surface p-4 sm:p-5">
        <Kicker>The beam</Kicker>
        <h2 className="mt-2 text-3xl text-fg">Every group, one desk.</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Other captains lock on by using the brief above. A group that rewrites the ask, picks another office, or misses the window is not on this beam. Pledges are promises. They are not calls.
        </p>
        <p className="mt-4 font-display text-4xl tabular-nums text-fg">
          {pledged}
          <span className="ml-2 font-sans text-base text-muted">
            pledged across {beam.length} {beam.length === 1 ? "group" : "groups"}
          </span>
        </p>
        <p className="mt-1 text-sm text-muted">
          Your log is separate: {entries.length} real contacts toward {campaign.threshold}.
        </p>
        <div className="mt-4">
          <Meter value={pledged} max={Math.max(campaign.threshold, pledged, 1)} />
        </div>
        <div className="mt-5 flex flex-col gap-3">
          {beam.length === 0 ? (
            <p className="text-sm text-muted">
              No other group is locked yet. Send the captain brief. Add them when they answer.
            </p>
          ) : (
            beam.map((ally) => (
              <div key={ally.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-fg">
                  {ally.name}
                  <span className="text-muted">
                    {" "}
                    · {ally.pledged} · {ally.channel}
                  </span>
                </span>
                <button type="button" className={btnQuiet} onClick={() => removeAlly(ally.id)}>
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <input
            className={fieldClass}
            placeholder="Group name"
            value={allyName}
            onChange={(event) => setAllyName(event.target.value)}
          />
          <input
            className={fieldClass}
            inputMode="numeric"
            placeholder="How many will call"
            value={allyCount}
            onChange={(event) => setAllyCount(event.target.value)}
          />
          <input
            className={fieldClass}
            placeholder="Signal, WhatsApp, text"
            value={allyChannel}
            onChange={(event) => setAllyChannel(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={cn(btnSignal, "mt-3")}
          onClick={() => {
            addAlly(campaign.id, allyName, Number(allyCount), allyChannel);
            setAllyName("");
          }}
        >
          Lock this group on the desk
        </button>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <Kicker>Log the contact</Kicker>
            <p className="mt-2 font-display text-4xl tabular-nums text-fg">
              {entries.length}
              <span className="ml-2 font-sans text-base text-muted">
                / {campaign.threshold}
              </span>
            </p>
          </div>
        </div>
        <div className="mt-4">
          <Meter value={entries.length} max={campaign.threshold} />
        </div>
        <p className="mt-3 text-sm text-muted">
          Log only what a real person did. This count stays on your device. It is
          not a national total and it is not inflated.
        </p>
        <label className="mt-4 flex flex-col gap-2 text-sm text-muted">
          Who made the contact
          <select
            className="min-h-11 rounded-md border border-line bg-raised px-3 text-base text-fg"
            value={who}
            onChange={(event) => setWho(event.target.value)}
          >
            <option value="You">You</option>
            {cell.map((member) => (
              <option key={member.id} value={member.name}>
                {member.name}
                {member.place ? ` · ${member.place}` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {waves.map((wave) => (
            <button
              key={wave.id}
              type="button"
              className={cn(btnSignal, "h-auto flex-col items-start py-3 text-left")}
              onClick={() => logContact(campaign.id, wave.id, who)}
            >
              <span>Log {wave.label.toLowerCase()}</span>
              <span className="font-normal text-signal-ink">{wave.hint}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-3">
          {entries.length === 0 ? (
            <p className="text-sm text-muted">
              The board is quiet. The first call is yours.
            </p>
          ) : (
            entries.slice(0, 8).map((entry) => (
              <div key={entry.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-fg">
                  {entry.who} · {waves.find((item) => item.id === entry.wave)?.label ?? entry.wave}
                </span>
                <span className="shrink-0 text-muted tabular-nums">
                  {clock ? formatWhen(entry.at, clock) : ""}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {entries.length > 0 ? (
            <button type="button" className={btnQuiet} onClick={() => clearLog(campaign.id)}>
              Clear this log
            </button>
          ) : null}
          {!campaign.seeded ? (
            <button
              type="button"
              className={btnQuiet}
              onClick={() => removeCampaign(campaign.id)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete this desk
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map((part) => Number(part));
  if (Number.isNaN(h) || Number.isNaN(m)) return 9 * 60;
  return h * 60 + m;
}
