import { btnGhost, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { APP_NAME, POST_TYPES, ROOMS, RULE_LABEL, type HardRule } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

const RULES = Object.keys(RULE_LABEL) as HardRule[];

const HOW = [
  { title: "Getting in", text: "Someone who hosts a meeting gives you a code. You enter your name and the code, and you are a member and on the list for that meeting. There is no public sign-up." },
  { title: "The week", text: "The front page is the next seven days: which meetings are on, where, and who is going. Press \"I'll be there\" on the ones you will attend." },
  { title: "After a meeting", text: "The host writes it up: how it went, who came, and the next date. If someone did something worth mentioning, the host can name one person. There is no headcount and no score." },
  { title: "Who can see you", text: "People who have been to the same meeting as you can see your profile and message you. Nobody else can. Messages are between two people, kept 30 days, and not encrypted." },
  { title: "Posting", text: "In a room you can post something you did, with proof, or ask one question. Posts are in order of time; nothing is ranked and nothing refreshes on its own." },
  { title: "Tradesmen", text: "A tradesman is listed in The Shop only after two members post that he did work for them. A business cannot list itself." },
  { title: "Church needs", text: "In a church room the organizer can post a family that needs meals this week, as a list of days. You put your name on a day. Nothing is enforced beyond that." },
  { title: "Moderation", text: "Three things get a post removed and the poster barred for 30 days: threats of violence, pornography, child sexual abuse material. Everything else stays up. Stewards can mark a post as sloppy or unsupported, which moves it down but does not remove it, and every mark is listed in the room for all to see." },
];

export function AboutView() {
  const me = useBoard((state) => state.me);
  const setMe = useBoard((state) => state.setMe);
  const steward = useBoard((state) => state.steward);
  const removals = useBoard((state) => state.removals);
  const loadSample = useBoard((state) => state.loadSample);
  const clearBoard = useBoard((state) => state.clearBoard);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <Kicker>About</Kicker>
        <h1 className="max-w-2xl font-display text-4xl text-balance text-fg lg:text-5xl">A private app for the people you see at church, at the shop, and at the county.</h1>
        <p className="max-w-prose text-base text-muted">
          {APP_NAME} shows you the week's meetings, lets you say you will be there, and lets the host record who came. You get in by invitation to a real meeting. There is no feed to scroll and nothing to like. Open it, see where to be, go.
        </p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">What we stand for</h2>
        <p className="mt-2 text-sm text-muted">[OWNER TO WRITE]</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl text-fg">How it works</h2>
        <dl className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
          {HOW.map((item) => (
            <div key={item.title} className="flex flex-col gap-1">
              <dt className="font-semibold text-fg">{item.title}</dt>
              <dd className="max-w-prose text-sm text-muted">{item.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl text-fg">The rooms</h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
          {ROOMS.map((room) => (
            <div key={room.id} className="contents">
              <dt className="font-semibold text-fg">{room.name}</dt>
              <dd className="max-w-prose text-muted">{room.what}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl text-fg">Kinds of post</h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
          {POST_TYPES.map((type) => (
            <div key={type.id} className="contents">
              <dt className="font-semibold text-fg">{type.label}</dt>
              <dd className="max-w-prose text-muted">{type.what}</dd>
            </div>
          ))}
        </dl>
        <p className="max-w-prose text-sm text-muted">
          Removed for: {RULES.map((rule) => RULE_LABEL[rule].toLowerCase()).join(", ")}. A second removal closes the account.
        </p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">You</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-muted">
            Your name, as it appears on your posts
            <input className={fieldClass} value={me} placeholder="Your name" onChange={(event) => setMe(event.target.value)} />
          </label>
          <p className="self-end text-sm text-muted">{steward ? "You are a steward: you can post notices and remove posts." : "Stewards are appointed by the founder."}</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" className={btnSignal} onClick={loadSample}>
            Load the sample week
          </button>
          <button type="button" className={btnGhost} onClick={clearBoard}>
            Clear the board
          </button>
        </div>
        <p className="mt-2 max-w-prose text-sm text-muted">The sample is six invented people and a week of meetings, for trying the app. It replaces whatever is here, and you become "Josh."</p>
      </section>

      {removals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl text-fg">Removed posts</h2>
          <ul className="flex flex-col gap-2">
            {removals.map((row) => (
              <li key={row.id} className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
                {new Date(row.at).toLocaleString()} · {row.author} · {RULE_LABEL[row.reason]}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
