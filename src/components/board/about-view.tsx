import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { InviteTracker } from "./invite-tracker";
import { isMyRemoval } from "@/lib/board/removal-owner";

export { isMyRemoval };
import { btnGhost, btnQuiet, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { DeletionRequestQueue } from "@/components/board/account-removal";
import { useCategories } from "@/components/board/use-categories";
import { browseCategories } from "@/lib/board/categories";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { ServerInvite } from "@/components/board/server-invite";
import { MfaResetQueue } from "@/components/board/mfa-ui";
import { useServerSession } from "@/lib/server-session-state";
import { fetchAccountExport, stepUpMfa } from "@/lib/mfa-api";
import { RoomsManager } from "@/components/board/rooms-manager";
import { BanReviewQueue } from "@/components/board/suspension";
import { AudienceChoice, RoomAudienceMark } from "@/components/board/audience";
import { cn } from "@/lib/cn";
import { DM_ABOUT_NOTICE } from "@/lib/e2ee/copy";
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
    text: 'The front page is the next seven days: which meetings are on and where. Who\'s coming stays private. Only admins see the list. Press "I\'ll be there" on the ones you will attend.',
  },
  {
    title: "After a meeting",
    text: "The host writes it up: how it went, who came, and the next date. If someone did something worth mentioning, the host can name one person. There is no headcount and no score.",
  },
  {
    title: "Who can see you",
    text: DM_ABOUT_NOTICE,
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
    text: "These get a post removed: calls for violence, threats, plans or instructions to attack or intimidate someone, doxxing, pornography, child sexual abuse material, and blasphemy (a post that mocks God or Christ). A removal bars filing for 30 days. A second removal by a steward suspends the account everywhere on Avouch until an admin reviews it. Pornography and child sexual abuse material removed by a steward suspend the account everywhere on Avouch the first time, and an admin then reviews it. When an admin removes it, the account is closed at once. Child sexual abuse material is removed at once and the evidence is held for one year, pending counsel. A child sexual abuse material closure is never lifted. An admin queue prepares the report for the NCMEC CyberTipline. Josh files that report by hand. The app does not send it, and it never shows the content. Stewards can mark a post Sloppy, No legs, or Out of scope, with one sentence saying why. A mark dims the post. It does not move it and it does not hide it. A steward can mark, remove, or decide an appeal only in a room they steward. The author can appeal a mark or a removal. An admin decides appeals of pornography removals, and a pornography closure can be appealed only with proof that someone else took over the account. The author, the stewards of that room, and an admin can read the appeal.",
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
  const server = useServerSession();
  const [exportCode, setExportCode] = useState("");
  const [exportError, setExportError] = useState("");
  const founded = useBoard((state) => state.founded);
  const remote = useBoard((state) => state.remote);
  const clearLocalBoard = useBoard((state) => state.clearLocalBoard);
  const undoClear = useBoard((state) => state.undoClear);
  const undoClearBoard = useBoard((state) => state.undoClearBoard);
  const posts = useBoard((state) => state.posts);
  const cards = useBoard((state) => state.cards);
  const profile = useBoard((state) => state.profile);
  const threads = useBoard((state) => state.threads);
  const messages = useBoard((state) => state.messages);
  const invites = useBoard((state) => state.invites);
  const bans = useBoard((state) => state.bans);
  const markLog = useBoard((state) => state.markLog);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearPhrase, setClearPhrase] = useState("");
  const mayClear = canClearBoard({ admin, owner: localBoardOwner({ founded }) });
  const boardSnapshot = () =>
    boardExportDocument({
      me,
      profile,
      rooms: rooms.map((room) => ({ id: room.id, name: room.name })),
      posts,
      cards,
      threads,
      messages,
      invites,
      bans,
      markLog,
      removals,
      appeals,
      reports: csamReports,
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
        <h1 className="illum max-w-2xl font-display text-4xl text-balance text-fg lg:text-5xl">
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
        <p className="mt-3 max-w-[65ch] text-base leading-relaxed text-fg sm:text-lg">
          Avouch exists so you can see what is happening in your community, meet face to face, then
          log off and go do the work. It is not a replacement for other social media, but a tool to
          help you get away from the machine. We want to rebuild what our founders assumed and
          modernity dissolved: the family, the parish, the town, and honest work.
        </p>
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
              <dt className="font-semibold text-fg">
                {room.name} <RoomAudienceMark audience={room.audience} />
              </dt>
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
          removal by a steward suspends the account everywhere on Avouch until an admin reviews it. Pornography and child sexual abuse material
          removed by a steward suspend the account everywhere on Avouch the first time, and an admin then reviews it. When an admin removes it, the
          account is closed at once.
          A child sexual abuse material closure is never lifted. A pornography closure can be appealed
          only with proof that someone else took over the account.
        </p>
        <ul className="flex max-w-prose flex-col gap-1 text-sm text-muted">
          {RULES.map((rule) => (
            <li key={rule}>{RULE_SENTENCE[rule]}</li>
          ))}
        </ul>
      </section>

      {remote ? <RoleTools changeAccess={changeAccess} admin={admin} /> : null}
      {remote && admin ? <MfaResetQueue /> : null}

      {remote && admin ? (
        <p>
          <a className={btnGhost} href="/admin/stats">
            Stats
          </a>
        </p>
      ) : null}

      {remote && admin ? (
        <AdminTools
          createRoom={createRoom}
          correctZip={correctZip}
          accessLog={home?.accessLog ?? []}
        />
      ) : null}

      {remote && admin ? <DeletionRequestQueue /> : null}
      {remote && admin ? <RoomsManager /> : null}

      {remote && admin ? <CsamQueue reports={csamReports} /> : null}
      {remote && admin ? <BanReviewQueue /> : null}

      {remote && admin ? <InviteTracker /> : null}

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
            Posts, marks, removals, and bans are on the server.
          </p>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
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
              title="Clear the board?"
              description="Everything here will be removed."
              confirmLabel="Clear it"
              cancelLabel="Keep it"
              confirmDisabled={!clearPhraseMatches(clearPhrase, APP_NAME)}
              onConfirm={() => {
                if (!clearPhraseMatches(clearPhrase, APP_NAME)) return;
                setConfirmClear(false);
                setClearPhrase("");
                clearLocalBoard();
              }}
              onCancel={() => {
                setConfirmClear(false);
                setClearPhrase("");
              }}
            >
              <label className="mt-4 flex flex-col gap-2 text-sm text-muted">
                Type {APP_NAME} or CLEAR
                <input
                  aria-label={`Type ${APP_NAME} or CLEAR`}
                  className={cn(fieldClass, "min-h-[44px]")}
                  value={clearPhrase}
                  autoComplete="off"
                  onChange={(event) => setClearPhrase(event.target.value)}
                />
              </label>
              <p className="mt-3 max-w-prose text-sm text-muted">
                The file includes the posts, messages, invites, bans, marks, removals, appeals, and
                reports saved in this browser.
              </p>
              <label className="mt-3 flex flex-col gap-2 text-sm text-muted">
                Authenticator code, if yours is on
                <input
                  className={cn(fieldClass, "min-h-[44px] font-mono tracking-widest")}
                  value={exportCode}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  onChange={(event) => setExportCode(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={cn(btnGhost, "mt-3 min-h-[44px]")}
                onClick={() => {
                  void (async () => {
                    setExportError("");
                    if (server.mode === "live" && (server.mfaEnrolled || server.mfa === "enroll")) {
                      const stepped = await stepUpMfa("data-export", exportCode.trim());
                      if (!stepped.ok) {
                        setExportError(stepped.message);
                        return;
                      }
                      const remote = await fetchAccountExport();
                      if (!remote.ok) {
                        setExportError(remote.message);
                        return;
                      }
                    }
                    downloadBoardExport(boardSnapshot());
                  })();
                }}
              >
                Export first
              </button>
              {exportError ? (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {exportError}
                </p>
              ) : null}
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
          </>
        )}
      </section>

      {removals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl text-fg">
            {steward || admin ? "Hard removals" : "Your removals"}
          </h2>
          {steward || admin ? null : (
            <p className="max-w-prose text-sm text-muted">
              A steward removed these posts of yours. You can appeal each one to that room's
              stewards here, even while the room is off your list.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {removals.map((row) => (
              <li
                key={row.id}
                className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted"
              >
                {new Date(row.at).toLocaleString()} · {row.roomChat ? "Room chat" : "Post"} ·{" "}
                {row.author} · {RULE_LABEL[row.reason]}
                {isMyRemoval(row, { remote, name: authorName(me) }) && !row.roomChat ? (
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
  const [sent, setSent] = useState(false);
  const fieldId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const done = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (sent) done.current?.focus();
  }, [sent]);
  if (filed || sent) {
    return (
      <p ref={done} tabIndex={-1} role="status" className="mt-2">
        Appeal filed with the stewards. They will read it and decide.
      </p>
    );
  }
  if (!open) {
    return (
      <button
        ref={opener}
        type="button"
        className={`${btnGhost} mt-2 min-h-[44px]`}
        aria-expanded={false}
        onClick={() => setOpen(true)}
      >
        Appeal this removal
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-2">
      <label htmlFor={fieldId}>One sentence to the stewards</label>
      <input
        id={fieldId}
        ref={input}
        className={`${fieldClass} min-h-[44px]`}
        placeholder="For example: I was quoting the rule, not breaking it."
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
          setError("");
        }}
      />
      {error ? (
        <p className="text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          className={`${btnSignal} min-h-[44px]`}
          onClick={() => {
            void appeal(postId, "removal", reason).then((result) => {
              if (!result.ok) {
                setError(result.error ?? "That appeal was not filed.");
                input.current?.focus();
              } else {
                setOpen(false);
                setSent(true);
              }
            });
          }}
        >
          File appeal
        </button>
        <button
          type="button"
          className={`${btnGhost} min-h-[44px]`}
          onClick={() => {
            setOpen(false);
            setError("");
            window.setTimeout(() => opener.current?.focus(), 0);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function roomTitle(rooms: { id: string; name: string }[], id: string): string {
  const typed = id.trim();
  if (!typed) return "";
  const room = rooms.find((item) => item.id === typed);
  const named = room?.name.trim();
  return named || typed;
}

function roleName(role: string): string {
  if (role === "member") return "Member";
  if (role === "admin") return "Admin";
  return "Steward";
}

function RoleTools({
  changeAccess,
  admin,
}: {
  changeAccess: (input: AccessInput) => Promise<{ ok: boolean; error?: string }>;
  admin: boolean;
}) {
  const rooms = useBoard((state) => state.rooms);
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">Roles</h2>
      <p className="max-w-prose text-sm text-muted">
        A member is one inviter. A later steward is the inviter plus a steward of that room. The
        first steward of a room is the inviter plus the council chair. An admin is already a
        steward, plus the role owner's sign-off. Each change is written in the access log.
      </p>
      <p className="max-w-prose text-sm text-muted">
        Grant adds a role. Revoke takes one away. A steward can mark and remove posts in one room.
        An admin is a heavier grant and stays on its own button.
      </p>
      <RoleForm
        title="Add member"
        rooms={rooms}
        done="Member granted."
        onSubmit={(fields) =>
          changeAccess({ action: "grant-member", email: fields.email, roomId: fields.roomId })
        }
      >
        {(fields) => (
          <>
            <EmailField value={fields.email} onChange={fields.setEmail} />
            <RoomField value={fields.roomId} onChange={fields.setRoomId} />
          </>
        )}
      </RoleForm>
      <RoleForm
        title="Add steward"
        rooms={rooms}
        confirmFirst
        done="Steward granted."
        onSubmit={(fields) =>
          changeAccess({
            action: "grant-steward",
            email: fields.email,
            roomId: fields.roomId,
            inviterEmail: fields.inviterEmail,
          })
        }
      >
        {(fields) => (
          <>
            <EmailField value={fields.email} onChange={fields.setEmail} />
            <RoomField value={fields.roomId} onChange={fields.setRoomId} />
            <label className="flex flex-col gap-2 text-sm text-muted">
              Inviter email
              <input
                className={fieldClass}
                value={fields.inviterEmail}
                onChange={(event) => fields.setInviterEmail(event.target.value)}
              />
            </label>
          </>
        )}
      </RoleForm>
      {admin ? (
        <RoleForm
          title="Add admin"
          rooms={rooms}
          done="Admin granted."
          onSubmit={(fields) =>
            changeAccess({
              action: "grant-admin",
              email: fields.email,
              stewardEmail: fields.stewardEmail,
            })
          }
        >
          {(fields) => (
            <>
              <EmailField value={fields.email} onChange={fields.setEmail} />
              <label className="flex flex-col gap-2 text-sm text-muted">
                Steward email
                <input
                  className={fieldClass}
                  value={fields.stewardEmail}
                  onChange={(event) => fields.setStewardEmail(event.target.value)}
                />
              </label>
            </>
          )}
        </RoleForm>
      ) : null}
      {admin ? <RevokeRole rooms={rooms} changeAccess={changeAccess} /> : null}
    </section>
  );
}

function EmailField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-2 text-sm text-muted">
      Member email
      <input
        className={fieldClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function RoomField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-2 text-sm text-muted">
      Room
      <input
        className={fieldClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function RoleForm({
  title,
  rooms,
  done,
  onSubmit,
  children,
  confirmFirst = false,
}: {
  title: string;
  rooms: { id: string; name: string }[];
  done: string;
  onSubmit: (fields: RoleFields) => Promise<{ ok: boolean; error?: string }>;
  children: (fields: RoleFields) => ReactNode;
  /** Granting a steward asks first. Member and admin grants do not. */
  confirmFirst?: boolean;
}) {
  const fields = useRoleFields();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [pending, setPending] = useState<null | "grant-steward">(null);
  const room = roomTitle(rooms, fields.roomId);
  const who = fields.email.trim() || "this person";
  const send = () => {
    setError("");
    setNotice("");
    void (async () => {
      if (mfaCode.trim()) {
        const stepped = await stepUpMfa("role-grant", mfaCode.trim());
        if (!stepped.ok) {
          setError(stepped.message);
          return;
        }
      }
      const result = await onSubmit(fields);
      if (!result.ok) {
        setError(result.error ?? "That role was not changed.");
        return;
      }
      setNotice(done);
    })();
  };
  return (
    <details className="rounded-md border border-line p-3">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-base text-fg">{title}</summary>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmFirst) {
            setPending("grant-steward");
            return;
          }
          send();
        }}
      >
        {children(fields)}
        <label className="flex flex-col gap-2 text-sm text-muted">
          Authenticator code
          <input
            className={cn(fieldClass, "min-h-[44px] font-mono tracking-widest")}
            value={mfaCode}
            inputMode="numeric"
            autoComplete="one-time-code"
            onChange={(event) => setMfaCode(event.target.value)}
          />
        </label>
        <button type="submit" className={cn(btnSignal, "self-start min-h-[44px]")}>
          {title}
        </button>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-muted">
            {notice}
          </p>
        ) : null}
      </form>
      {confirmFirst ? (
        <ConfirmDialog
          open={pending !== null}
          title="Grant steward?"
          description={`Make ${who} a steward${room ? ` of ${room}` : ""}? A steward can mark and remove posts in that room.`}
          confirmLabel="Grant steward"
          cancelLabel="Not now"
          tone="neutral"
          onConfirm={() => {
            setPending(null);
            send();
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </details>
  );
}

type RoleFields = {
  email: string;
  setEmail: (value: string) => void;
  roomId: string;
  setRoomId: (value: string) => void;
  inviterEmail: string;
  setInviterEmail: (value: string) => void;
  stewardEmail: string;
  setStewardEmail: (value: string) => void;
};

function useRoleFields(): RoleFields {
  const [email, setEmail] = useState("");
  const [roomId, setRoomId] = useState("");
  const [inviterEmail, setInviterEmail] = useState("");
  const [stewardEmail, setStewardEmail] = useState("");
  return {
    email,
    setEmail,
    roomId,
    setRoomId,
    inviterEmail,
    setInviterEmail,
    stewardEmail,
    setStewardEmail,
  };
}

function RevokeRole({
  rooms,
  changeAccess,
}: {
  rooms: { id: string; name: string }[];
  changeAccess: (input: AccessInput) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [email, setEmail] = useState("");
  const [roomId, setRoomId] = useState("");
  const [role, setRole] = useState<NonNullable<AccessInput["role"]>>("steward");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [pending, setPending] = useState<null | "revoke">(null);
  const room = roomTitle(rooms, roomId);
  const who = email.trim() || "this person";
  const send = () => {
    setError("");
    setNotice("");
    void (async () => {
      if (mfaCode.trim()) {
        const stepped = await stepUpMfa("role-grant", mfaCode.trim());
        if (!stepped.ok) {
          setError(stepped.message);
          return;
        }
      }
      const result = await changeAccess({ action: "revoke", email, role, roomId });
      if (!result.ok) {
        setError(result.error ?? "That role was not changed.");
        return;
      }
      setNotice("Role revoked.");
    })();
  };
  return (
    <details className="rounded-md border border-line p-3">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-base text-fg">
        Revoke a role
      </summary>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPending("revoke");
        }}
      >
        <EmailField value={email} onChange={setEmail} />
        <RoomField value={roomId} onChange={setRoomId} />
        <label className="flex flex-col gap-2 text-sm text-muted">
          Role to revoke
          <select
            className={cn(fieldClass, "min-h-[44px]")}
            value={role}
            onChange={(event) => setRole(event.target.value as NonNullable<AccessInput["role"]>)}
          >
            <option value="member">Member</option>
            <option value="steward">Steward</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Authenticator code
          <input
            className={cn(fieldClass, "min-h-[44px] font-mono tracking-widest")}
            value={mfaCode}
            inputMode="numeric"
            autoComplete="one-time-code"
            onChange={(event) => setMfaCode(event.target.value)}
          />
        </label>
        <button type="submit" className={cn(btnQuiet, "self-start min-h-[44px] text-danger")}>
          Revoke
        </button>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-muted">
            {notice}
          </p>
        ) : null}
      </form>
      <ConfirmDialog
        open={pending !== null}
        title="Revoke this role?"
        description={`Revoke ${roleName(role)} from ${who}${room ? ` in ${room}` : ""}? That access goes away.`}
        confirmLabel="Revoke"
        cancelLabel="Keep it"
        onConfirm={() => {
          setPending(null);
          send();
        }}
        onCancel={() => setPending(null)}
      />
    </details>
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
    categoryIds: string[];
    audience?: "all" | "men" | "women";
  }) => Promise<{ ok: boolean; error?: string }>;
  correctZip: (input: ZipCorrectionInput) => Promise<{ ok: boolean; error?: string }>;
  accessLog: HomeAccessRow[];
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [what, setWhat] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const categories = browseCategories(useCategories(), false);
  const [audience, setAudience] = useState<"all" | "men" | "women">("all");
  const [zip, setZip] = useState("");
  const [town, setTown] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [clearZip, setClearZip] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [zipError, setZipError] = useState("");
  const [zipNote, setZipNote] = useState("");

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">Admin</h2>
      <p className="max-w-prose text-sm text-muted">
        A topic room is added here. A town, congregation, or wider room is a request you approve on
        Home. A ZIP correction is an append-only log. An empty town clears that ZIP.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-muted">
          Room
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
        <fieldset className="flex flex-col gap-1 sm:col-span-2">
          <legend className="text-sm text-muted">Categories</legend>
          {categories.map((category) => {
            const checked = categoryIds.includes(category.slug);
            return (
              <label
                key={category.slug}
                className="inline-flex min-h-[44px] items-center gap-2 text-sm text-fg"
              >
                <input
                  type="checkbox"
                  className="size-5"
                  checked={checked}
                  onChange={() => {
                    setCategoryIds(
                      checked
                        ? categoryIds.filter((slug) => slug !== category.slug)
                        : [...categoryIds, category.slug],
                    );
                  }}
                />
                {category.name}
              </label>
            );
          })}
        </fieldset>
        <div className="sm:col-span-2">
          <AudienceChoice
            legend="Who can be in this room"
            name="create-room-audience"
            value={audience}
            onChange={setAudience}
          />
        </div>
      </div>
      <button
        type="button"
        className={btnSignal}
        onClick={() => {
          setRoomError("");
          if (categoryIds.length === 0) {
            setRoomError("Choose a category.");
            return;
          }
          void createRoom({ id, name, what, categoryIds, audience }).then((result) => {
            if (!result.ok) setRoomError(result.error ?? "The room was not added.");
            else {
              setId("");
              setName("");
              setWhat("");
              setCategoryIds([]);
              setAudience("all");
            }
          });
        }}
      >
        Add room
      </button>
      {roomError ? (
        <p role="alert" className="text-sm text-danger">
          {roomError}
        </p>
      ) : null}
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
          setZipError("");
          setZipNote("");
          void correctZip({ zip, name: town, state: stateCode, clear: clearZip }).then((result) => {
            if (!result.ok) setZipError(result.error ?? "That ZIP was not corrected.");
            else setZipNote(clearZip ? "That ZIP is cleared." : "The ZIP is corrected.");
          });
        }}
      >
        Correct ZIP
      </button>
      <p className="text-[0.8125rem] text-muted" aria-live="polite">
        {zipNote}
      </p>
      {zipError ? (
        <p role="alert" className="text-sm text-danger">
          {zipError}
        </p>
      ) : null}
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
    </section>
  );
}
