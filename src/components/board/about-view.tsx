import { useState } from "react";
import { btnGhost, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { ServerInvite } from "@/components/board/server-invite";
import type { HomeAccessRow } from "@/lib/board/home";
import type { AccessInput, ZipCorrectionInput } from "@/lib/board/client";
import { APP_NAME, POST_TYPES, RULE_LABEL, type HardRule } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

const RULES = Object.keys(RULE_LABEL) as HardRule[];

const HOW = [
  {
    title: "Getting in",
    text: "Someone who hosts a meeting gives you a code. You enter your name and the code, and you are a member and on the list for that meeting. There is no public sign-up.",
  },
  {
    title: "The week",
    text: 'The front page is the next seven days: which meetings are on, where, and who is going. Press "I\'ll be there" on the ones you will attend.',
  },
  {
    title: "After a meeting",
    text: "The host writes it up: how it went, who came, and the next date. If someone did something worth mentioning, the host can name one person. There is no headcount and no score.",
  },
  {
    title: "Who can see you",
    text: "People who have been to the same meeting as you can see your profile and message you. Nobody else can. Messages are between two people, kept 30 days, and not encrypted.",
  },
  {
    title: "Room chat",
    text: "Each room has a chat for people who have stood in that room. Lines stay in time order. A removed or barred member loses access on the next check. A steward can remove a line only in a room they steward. The lines are plain text.",
  },
  {
    title: "Posting",
    text: "In a room you can post something you did, with proof, or ask one question. Posts are in order of time; nothing is ranked and nothing refreshes on its own.",
  },
  {
    title: "Debates",
    text: "Debate Night is a monthly debate at a brewery or a hall: one question, two sides, a host, anyone welcome. The card shows this month's question and where. Afterwards the host writes up how it went and sets next month's question.",
  },
  {
    title: "Tradesmen",
    text: "A tradesman is listed in The Shop only after two members post that he did work for them. A business cannot list itself.",
  },
  {
    title: "Church needs",
    text: "In a church room the organizer can post a family that needs meals this week, as a list of days. You put your name on a day. Nothing is enforced beyond that.",
  },
  {
    title: "Moderation",
    text: "Three things get a post removed and the poster barred for 30 days: threats of violence, pornography, child sexual abuse material. Everything else stays up. Stewards can mark a post as sloppy or unsupported, with one sentence saying why. A mark dims the post. It does not move it and it does not hide it.",
  },
  {
    title: "Home",
    text: "Home lists the rooms you joined, then your ZIP town, then your congregation, then farther out. Inside a room, posts stay newest first. A council approval adds the label Council-approved. It does not rank the post.",
  },
];

export function AboutView() {
  const me = useBoard((state) => state.me);
  const setMe = useBoard((state) => state.setMe);
  const steward = useBoard((state) => state.steward);
  const removals = useBoard((state) => state.removals);
  const rooms = useBoard((state) => state.rooms);
  const admin = useBoard((state) => state.admin);
  const remote = useBoard((state) => state.remote);
  const loadSample = useBoard((state) => state.loadSample);
  const clearBoard = useBoard((state) => state.clearBoard);
  const createRoom = useBoard((state) => state.createRoom);
  const home = useBoard((state) => state.home);
  const changeAccess = useBoard((state) => state.changeAccess);
  const correctZip = useBoard((state) => state.correctZip);

  return (
    <div className="flex flex-col gap-10">
      <ServerInvite />
      <section className="flex flex-col gap-3">
        <Kicker>About</Kicker>
        <h1 className="max-w-2xl font-display text-4xl text-balance text-fg lg:text-5xl">
          A private app for the people you see at church, at the shop, and at the county.
        </h1>
        <p className="max-w-prose text-base text-muted">
          {APP_NAME} shows you the week's meetings, lets you say you will be there, and lets the
          host record who came. You get in by invitation to a real meeting. There is no feed to
          scroll and nothing to like. Open it, see where to be, go.
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
          {rooms.map((room) => (
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
          Removed for: {RULES.map((rule) => RULE_LABEL[rule].toLowerCase()).join(", ")}. A second
          removal closes the account.
        </p>
      </section>

      {remote ? <RoleTools changeAccess={changeAccess} admin={admin} /> : null}

      {remote && admin ? (
        <AdminTools
          createRoom={createRoom}
          correctZip={correctZip}
          accessLog={home?.accessLog ?? []}
        />
      ) : null}

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">You</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-muted">
            Your name, as it appears on your posts
            <input
              className={fieldClass}
              value={me}
              placeholder="Your name"
              onChange={(event) => setMe(event.target.value)}
            />
          </label>
          <p className="self-end text-sm text-muted">
            {steward
              ? "You are a steward of a room. You can post notices and mark a post. A mark dims it."
              : "A steward needs the inviter and a steward of that room. The first steward of a room needs the inviter and the council chair."}
          </p>
        </div>
        {remote ? (
          <p className="mt-6 max-w-prose text-sm text-muted">
            Posts, marks, removals, and bans are on the server. The sample week stays in this
            browser, and only when the server is not configured.
          </p>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" className={btnSignal} onClick={loadSample}>
                Load the sample week
              </button>
              <button type="button" className={btnGhost} onClick={clearBoard}>
                Clear the board
              </button>
            </div>
            <p className="mt-2 max-w-prose text-sm text-muted">
              The sample is six invented people and a week of meetings, for trying the app. It
              replaces whatever is here, and you become "Josh."
            </p>
          </>
        )}
      </section>

      {removals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl text-fg">Hard removals</h2>
          <ul className="flex flex-col gap-2">
            {removals.map((row) => (
              <li
                key={row.id}
                className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted"
              >
                {new Date(row.at).toLocaleString()} · {row.roomChat ? "Room chat" : "Post"} ·{" "}
                {row.author} · {RULE_LABEL[row.reason]}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function RoleTools({
  changeAccess,
  admin,
}: {
  changeAccess: (input: AccessInput) => Promise<{ ok: boolean; error?: string }>;
  admin: boolean;
}) {
  const [email, setEmail] = useState("");
  const [roomId, setRoomId] = useState("");
  const [inviterEmail, setInviterEmail] = useState("");
  const [stewardEmail, setStewardEmail] = useState("");
  const [role, setRole] = useState<NonNullable<AccessInput["role"]>>("steward");
  const [message, setMessage] = useState("");
  const report = (result: { ok: boolean; error?: string }, ok: string) => {
    setMessage(result.ok ? ok : (result.error ?? "That role was not changed."));
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">Roles</h2>
      <p className="max-w-prose text-sm text-muted">
        A member is one inviter. A later steward is the inviter plus a steward of that room. The
        first steward of a room is the inviter plus the council chair. An admin is already a
        steward, plus the role owner's sign-off. Each change is written in the access log.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-muted">
          Member email
          <input className={fieldClass} value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Room id
          <input
            className={fieldClass}
            value={roomId}
            placeholder="shop"
            onChange={(event) => setRoomId(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Inviter email
          <input
            className={fieldClass}
            value={inviterEmail}
            onChange={(event) => setInviterEmail(event.target.value)}
          />
        </label>
        {admin ? (
          <label className="flex flex-col gap-2 text-sm text-muted">
            Steward email
            <input
              className={fieldClass}
              value={stewardEmail}
              onChange={(event) => setStewardEmail(event.target.value)}
            />
          </label>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btnSignal}
          onClick={() => {
            void changeAccess({ action: "grant-member", email, roomId }).then((result) =>
              report(result, "Member granted."),
            );
          }}
        >
          Grant member
        </button>
        <button
          type="button"
          className={btnSignal}
          onClick={() => {
            void changeAccess({ action: "grant-steward", email, roomId, inviterEmail }).then((result) =>
              report(result, "Steward granted."),
            );
          }}
        >
          Grant steward
        </button>
        {admin ? (
          <button
            type="button"
            className={btnSignal}
            onClick={() => {
              void changeAccess({ action: "grant-admin", email, stewardEmail }).then((result) =>
                report(result, "Admin granted."),
              );
            }}
          >
            Grant admin
          </button>
        ) : null}
      </div>
      {admin ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-2 text-sm text-muted">
            Role to revoke
            <select
              className={fieldClass}
              value={role}
              onChange={(event) => setRole(event.target.value as NonNullable<AccessInput["role"]>)}
            >
              <option value="member">Member</option>
              <option value="steward">Steward</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              void changeAccess({ action: "revoke", email, role, roomId }).then((result) =>
                report(result, "Role revoked."),
              );
            }}
          >
            Revoke
          </button>
        </div>
      ) : null}
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </section>
  );
}

function AdminTools({
  createRoom,
  correctZip,
  accessLog,
}: {
  createRoom: (input: {
    id: string;
    name: string;
    what: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  correctZip: (input: ZipCorrectionInput) => Promise<{ ok: boolean; error?: string }>;
  accessLog: HomeAccessRow[];
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [what, setWhat] = useState("");
  const [zip, setZip] = useState("");
  const [town, setTown] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [clearZip, setClearZip] = useState(false);
  const [message, setMessage] = useState("");

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">Admin</h2>
      <p className="max-w-prose text-sm text-muted">
        A topic room is added here. A town, congregation, or wider room is a request you approve on
        Home. A ZIP correction is an append-only log. An empty town clears that ZIP.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-muted">
          Room id
          <input
            className={fieldClass}
            value={id}
            placeholder="woodshop"
            onChange={(event) => setId(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Name
          <input
            className={fieldClass}
            value={name}
            placeholder="Woodshop"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted sm:col-span-2">
          What it is for
          <input
            className={fieldClass}
            value={what}
            onChange={(event) => setWhat(event.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className={btnSignal}
        onClick={() => {
          void createRoom({ id, name, what }).then((result) => {
            setMessage(result.ok ? "The room is up." : (result.error ?? "The room was not added."));
            if (result.ok) {
              setId("");
              setName("");
              setWhat("");
            }
          });
        }}
      >
        Add room
      </button>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-muted">
          ZIP to correct
          <input
            className={fieldClass}
            value={zip}
            onChange={(event) => setZip(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Town
          <input
            className={fieldClass}
            value={town}
            onChange={(event) => setTown(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          State
          <input
            className={fieldClass}
            value={stateCode}
            placeholder="FL"
            onChange={(event) => setStateCode(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 self-end text-sm text-muted">
          <input
            type="checkbox"
            className="size-4"
            checked={clearZip}
            onChange={(event) => setClearZip(event.target.checked)}
          />
          Clear this ZIP
        </label>
      </div>
      <button
        type="button"
        className={btnGhost}
        onClick={() => {
          void correctZip({ zip, name: town, state: stateCode, clear: clearZip }).then((result) => {
            setMessage(result.ok ? "The ZIP is corrected." : (result.error ?? "That ZIP was not corrected."));
          });
        }}
      >
        Correct ZIP
      </button>
      {accessLog.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {accessLog.map((row) => (
            <li key={row.id} className="text-sm text-muted">
              {new Date(row.at).toLocaleString()} · {row.action} {row.role}
              {row.roomId ? ` in ${row.roomId}` : ""} · {row.name}
              {row.note ? ` · ${row.note}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </section>
  );
}
