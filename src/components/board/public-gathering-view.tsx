import type { ReactNode } from "react";
import {
  INVITE_LINE,
  PRIVACY_LINE,
  publicClock,
  publicDateLabel,
  type PublicGathering,
} from "@/lib/board/public-gathering";
import { heroLabel } from "@/lib/board/engraved";

const HERO = heroLabel("week") ?? "Gustave Doré, Jacob’s Dream, 1866";

/** The engraved band and the plate. Loading, the page, and not-found all use it. */
export function PublicGatheringFrame({ children }: { children: ReactNode }) {
  return (
    <div className="shell gathering-page min-h-dvh overflow-x-clip text-fg" data-section="week">
      <div className="hero-band" role="img" aria-label={HERO} />
      <div className="shell-body">
        <main>
          <article className="plate plate--hero gathering-plate">{children}</article>
        </main>
      </div>
    </div>
  );
}

export function PublicGatheringLoading() {
  return (
    <PublicGatheringFrame>
      <p className="gathering-kicker">Avouch Social</p>
      <h1 className="gathering-title illum font-display text-4xl text-fg lg:text-5xl">Loading.</h1>
    </PublicGatheringFrame>
  );
}

export function PublicGatheringMissing() {
  return (
    <PublicGatheringFrame>
      <p className="gathering-kicker">Avouch Social</p>
      <h1 className="gathering-title illum font-display text-4xl text-fg lg:text-5xl">This gathering is not shared.</h1>
      <p className="gathering-copy">{INVITE_LINE}</p>
      <p className="gathering-links">
        <a href="/">The door</a>
      </p>
    </PublicGatheringFrame>
  );
}

/** Title, date, time, and town. Nothing else from the gathering is rendered. */
export function PublicGatheringView({ gathering }: { gathering: PublicGathering }) {
  const date = publicDateLabel(gathering.date);
  const time = publicClock(gathering.time);
  return (
    <PublicGatheringFrame>
      <p className="gathering-kicker">Avouch Social</p>
      <h1 className="gathering-title illum font-display text-4xl text-balance text-fg lg:text-5xl">{gathering.title}</h1>
      {date ? (
        <p className="gathering-line">
          <time dateTime={gathering.date}>{date}</time>
        </p>
      ) : null}
      {time ? <p className="gathering-line">{time}</p> : null}
      {gathering.town ? <p className="gathering-town">{gathering.town}</p> : null}
      <p className="gathering-copy">{INVITE_LINE}</p>
      <p className="gathering-links">
        <a href="/">The door</a>
        <a href="#privacy">Privacy</a>
      </p>
      <section id="privacy">
        <h2 className="gathering-kicker">Privacy</h2>
        <p className="gathering-copy">{PRIVACY_LINE}</p>
      </section>
    </PublicGatheringFrame>
  );
}
