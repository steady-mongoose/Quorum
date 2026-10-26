import { publicDateLabel, type PublicGathering } from "@/lib/board/public-gathering";

/** Title, date, and town. Nothing else from the gathering is rendered. */
export function PublicGatheringView({ gathering }: { gathering: PublicGathering }) {
  const date = publicDateLabel(gathering.date);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-4 px-6 py-16">
      <p className="text-xs font-semibold tracking-widest text-muted uppercase">Avouch Social</p>
      <h1 className="text-4xl text-fg">{gathering.title}</h1>
      {date ? (
        <p className="text-base text-fg">
          <time dateTime={gathering.date}>{date}</time>
        </p>
      ) : null}
      {gathering.town ? <p className="text-base text-muted">{gathering.town}</p> : null}
    </main>
  );
}
