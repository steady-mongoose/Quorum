import { DOCTRINE } from "@/lib/quorum/model";
import { Kicker } from "@/components/quorum/bits";

export function DoctrineView() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Kicker>Why one office</Kicker>
        <h2 className="max-w-xl font-display text-3xl text-fg">
          Why everyone calls one official with one message.
        </h2>
        <p className="max-w-2xl text-base text-muted">
          Lobbyists do not need a crowd; they need one committee chair and a bill
          full of exceptions. Ordinary people answer that by all calling that one
          chair, in the same hour, asking for the same thing, as themselves. No
          bots, no fake names, no mass email. The eight points below say why.
        </p>
      </section>
      <div className="grid gap-4">
        {DOCTRINE.map((item, index) => (
          <article key={item.id} className="rounded-lg border border-line bg-surface p-4 sm:p-5">
            <p className="text-xs font-semibold tracking-widest text-signal uppercase">
              {String(index + 1).padStart(2, "0")} · {item.kicker}
            </p>
            <h2 className="mt-2 text-2xl text-fg">{item.title}</h2>
            <p className="mt-3 max-w-3xl text-base text-muted">{item.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
