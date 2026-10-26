import { useState } from "react";
import { btnGhost, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { ServerInvite } from "@/components/board/server-invite";
import { cn } from "@/lib/cn";
import type { HomeAccessRow } from "@/lib/board/home";
import type { AccessInput, ZipCorrectionInput } from "@/lib/board/client";
import {
  APP_NAME,
  POST_TYPES,
  RULE_LABEL,
  RULE_SENTENCE,
  authorName,
  type CsamReport,
  type HardRule,
} from "@/lib/board/model";
import {
  boardExportDocument,
  canClearBoard,
  clearPhraseMatches,
  clearPhraseRequired,
  localBoardOwner,
  useBoard,
} from "@/lib/board/store";

const RULES = Object.keys(RULE_LABEL) as HardRule[];

function downloadBoardExport(json: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "avouch-board.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

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
    text: "Five things get a post removed: threats of violence, pornography, child sexual abuse material, doxxing, and a post that mocks God or Christ. A removal bars filing for 30 days. A second removal closes the account. Child sexual abuse material is removed at once, the account is banned, and the evidence is held for one year, pending counsel. An admin queue prepares the report for the NCMEC CyberTipline. Josh files that report by hand. The app does not send it, and it never shows the content. Stewards can mark a post Sloppy, No legs, or Out of scope, with one sentence saying why. A mark dims the post. It does not move it and it does not hide it. A steward can mark, remove, or decide an appeal only in a room they steward. The author can appeal a mark or a removal to that room's stewards. The author, the stewards of that room, and an admin can read the appeal.",
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
  const appeals = useBoard((state) => state.appeals);
  const csamReports = useBoard((state) => state.csamReports);
  const appeal = useBoard((state) => state.appeal);
  const rooms = useBoard((state) => state.rooms);
  const admin = useBoard((state) => state.admin);
  const founded = useBoard((state) => state.founded);
  const remote = useBoard((state) => state.remote);
  const sample = useBoard((state) => state.sample);
  const loadSample = useBoard((state) => state.loadSample);
  const clearLocalBoard = useBoard((state) => state.clearLocalBoard);
  const undoClear = useBoard((state) => state.undoClear);
  const undoClearBoard = useBoard((state) => state.undoClearBoard);
  const posts = useBoard((state) => state.posts);
  const cards = useBoard((state) => state.cards);
  const profile = useBoard((state) => state.profile);
  const threads = useBoard((state) => state.threads);
  const messages = useBoard((state) => state.messages);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearPhrase, setClearPhrase] = useState("");
  const mayClear = canClearBoard({ admin, owner: localBoardOwner({ founded, sample }) });
  const phraseRequired = clearPhraseRequired(sample);
  const boardSnapshot = () =>
    boardExportDocument({
      me,
      sample,
      profile,
      rooms: rooms.map((room) => ({ id: room.id, name: room.name })),
      posts,
      cards,
      threads,
      messages,
    });
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
          removal closes the account. Child sexual abuse material closes it the first time.
        </p>
        <ul className="flex max-w-prose flex-col gap-1 text-sm text-muted">
          {RULES.map((rule) => (
            <li key={rule}>{RULE_SENTENCE[rule]}</li>
          ))}
        </ul>
      </section>

      {remote ? <RoleTools changeAccess={changeAccess} admin={admin} /> : null}

      {remote && admin ? (
        <AdminTools
          createRoom={createRoom}
          correctZip={correctZip}
          accessLog={home?.accessLog ?? []}
        />
      ) : null}

      {remote && admin ? <CsamQueue reports={csamReports} /> : null}

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
              <button type="button" className={cn(btnSignal, "min-h-[44px]")} onClick={loadSample}>
                Load the sample week
              </button>
              {mayClear ? (
                <button
                  type="button"
                  className={cn(btnGhost, "min-h-[44px]")}
                  onClick={() => {
                    setClearPhrase("");
                    setConfirmClear(true);
                  }}
                >
                  Clear the board
                </button>
              ) : null}
            </div>
            <ConfirmDialog
              open={confirmClear}
              title={sample ? "Clear the sample week?" : "Clear the board?"}
              description="Everything here will be removed."
              confirmLabel="Clear it"
              cancelLabel="Keep it"
              confirmDisabled={phraseRequired && !clearPhraseMatches(clearPhrase, APP_NAME)}
              onConfirm={() => {
                if (phraseRequired && !clearPhraseMatches(clearPhrase, APP_NAME)) return;
                setConfirmClear(false);
                setClearPhrase("");
                clearLocalBoard();
              }}
              onCancel={() => {
                setConfirmClear(false);
                setClearPhrase("");
              }}
            >
              {phraseRequired ? (
                <label className="mt-4 flex flex-col gap-2 text-sm text-muted">
                  Type {APP_NAME} or CLEAR
                  <input
                    className={cn(fieldClass, "min-h-[44px]")}
                    value={clearPhrase}
                    autoComplete="off"
                    onChange={(event) => setClearPhrase(event.target.value)}
                  />
                </label>
              ) : null}
              <button
                type="button"
                className={cn(btnGhost, "mt-3 min-h-[44px]")}
                onClick={() => downloadBoardExport(boardSnapshot())}
              >
                Export first
              </button>
            </ConfirmDialog>
            {undoClear ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <p className="max-w-prose text-sm text-muted">
                  The board was cleared. You can still put it back.
                </p>
                <button
                  type="button"
                  className={cn(btnGhost, "min-h-[44px]")}
                  onClick={() => undoClearBoard()}
                >
                  Put the board back
                </button>
              </div>
            ) : null}
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
                {row.author === authorName(me) ? (
                  <RemovalAppeal
                    postId={row.postId}
                    filed={appeals.some(
                      (item) =>
                        item.postId === row.postId &&
                        item.kind === "removal" &&
                        item.decision === null,
                    )}
                    appeal={appeal}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function CsamQueue({ reports }: { reports: CsamReport[] }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">CyberTipline queue</h2>
      <p className="max-w-prose text-sm text-muted">
        Prepared for the NCMEC CyberTipline under 18 U.S.C. 2258A. Josh files each report by hand.
        This page does not send it. The words and the pictures are not shown. The hold is one year,
        pending counsel.
      </p>
      {reports.length === 0 ? (
        <p className="text-sm text-muted">No report is waiting.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((report) => (
            <li
              key={report.id}
              className="rounded-md border border-line px-3 py-2 text-sm text-muted"
            >
              {report.status === "filed"
                ? "Filed"
                : report.status === "pending_seal"
                  ? "Not sealed"
                  : "Not filed"}
              {report.status === "filed" && report.reportId ? ` · report ${report.reportId}` : ""} ·{" "}
              {new Date(report.incidentAt).toLocaleString()} · {report.author} · account{" "}
              {report.accountId} · room {report.room} · post {report.postId} · {report.mediaCount}{" "}
              {report.mediaCount === 1 ? "file" : "files"}, {report.byteSize} bytes · hold until{" "}
              {new Date(report.retainUntil).toLocaleDateString()}
              {report.mediaTypes.length > 0 ? ` · ${report.mediaTypes.join(", ")}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RemovalAppeal({
  postId,
  filed,
  appeal,
}: {
  postId: string;
  filed: boolean;
  appeal: (
    postId: string,
    kind: "removal",
    reason: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (filed) return <p className="mt-2">Appeal filed with the stewards.</p>;
  if (!open) {
    return (
      <button type="button" className={`${btnGhost} mt-2`} onClick={() => setOpen(true)}>
        Appeal this removal
      </button>
    );
  }
  return (
    <label className="mt-2 flex flex-col gap-2">
      One sentence to the stewards
      <input
        className={fieldClass}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
          setError("");
        }}
      />
      {error ? <span className="text-signal">{error}</span> : null}
      <span className="flex gap-2">
        <button
          type="button"
          className={btnSignal}
          onClick={() => {
            void appeal(postId, "removal", reason).then((result) => {
              if (!result.ok) setError(result.error ?? "That appeal was not filed.");
              else setOpen(false);
            });
          }}
        >
          File appeal
        </button>
        <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
    </label>
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
          <input
            className={fieldClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
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
            void changeAccess({ action: "grant-steward", email, roomId, inviterEmail }).then(
              (result) => report(result, "Steward granted."),
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
            setMessage(
              result.ok ? "The ZIP is corrected." : (result.error ?? "That ZIP was not corrected."),
            );
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
