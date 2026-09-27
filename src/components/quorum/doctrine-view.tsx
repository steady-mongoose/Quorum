import { DOCTRINE } from "@/lib/quorum/model";
import { Kicker } from "@/components/quorum/bits";

export function DoctrineView() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Kicker>Operating manual</Kicker>
        <h1 className="max-w-xl font-display text-4xl text-fg">
          Do not teach the compromise.
        </h1>
        <p className="max-w-2xl text-base text-muted">
          Big money does not need a crowd. It needs one chair, one rule, and a
          bill full of exceptions. This is how a cell answers that without
          becoming the thing it opposes: no bots, no fake names, no blast. One
          standard, aimed at the person who can move it.
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
