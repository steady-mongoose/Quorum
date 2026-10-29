import { useEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { btnGhost, btnQuiet, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  fetchGroup,
  fetchGroupAppeals,
  fetchGroupInvites,
  fetchGroupRequests,
  fetchGroups,
  GROUP_INVITE_ONLY,
  postGroup,
  runByLine,
  type GroupAppealRow,
  type GroupDetail,
  type GroupInviteRow,
  type GroupPostRow,
  type GroupRemovalRow,
  type GroupRequestRow,
  type GroupSummary,
} from "@/lib/board/group-client";
import type { HomePayload } from "@/lib/board/home";
import { MARK_LABEL, RULE_LABEL, RULE_SENTENCE, type HardRule } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { RoomAudienceMark } from "@/components/board/audience";

const RULES = Object.keys(RULE_LABEL) as HardRule[];

/**
 * Theme groups from the server. The list stays in server order.
 * A group admin marks or removes. A steward upholds or lifts an appeal.
 * Nothing here is ranked.
 */
export function GroupsView() {
  const remote = useBoard((state) => state.remote);
  const home = useBoard((state) => state.home);
  const steward = useBoard((state) => state.steward);
  const admin = useBoard((state) => state.admin);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <Kicker>Groups</Kicker>
        <h1 className="font-display text-4xl text-fg lg:text-5xl">Interest groups</h1>
        <p className="max-w-prose text-base text-muted">
          Carpentry, gardening, brewing, and whatever a member asks for next. They sit beside town
          rooms. The list is alphabetical. A mark does not move a post.
        </p>
      </section>
      {remote ? (
        openId ? (
          <GroupDetailView
            id={openId}
            canDecide={steward || admin}
            onBack={() => setOpenId(null)}
          />
        ) : (
          <GroupList home={home} canDecide={steward || admin} onOpen={setOpenId} />
        )
      ) : (
        <p className="max-w-prose text-base text-muted">
          Sign in to see groups. They are kept on the server, in alphabetical order.
        </p>
      )}
    </div>
  );
}

function FormAlert({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-[#f0b4a4]">
      {message}
    </p>
  );
}

const NO_ROOMS: { id: string; name: string }[] = [];

function joinedRooms(home: HomePayload | null): { id: string; name: string }[] {
  const section = home?.sections.find((item) => item.tier === "joined");
  if (!section || section.tier !== "joined") return NO_ROOMS;
  return section.rooms;
}

function GroupList({
  home,
  canDecide,
  onOpen,
}: {
  home: HomePayload | null;
  canDecide: boolean;
  onOpen: (id: string) => void;
}) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [requests, setRequests] = useState<GroupRequestRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [rowError, setRowError] = useState("");
  const [rowId, setRowId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const [listed, asked] = await Promise.all([fetchGroups(), fetchGroupRequests()]);
      if (cancel) return;
      if (!listed.ok) {
        setLoadError(listed.error);
        return;
      }
      setGroups(listed.value);
      setRequests(asked.ok ? asked.value : []);
      setLoadError(asked.ok ? "" : asked.error);
    })();
    return () => {
      cancel = true;
    };
  }, [tick]);

  // Joining takes an invite, accepted on the group's page. Here a member can only leave.
  async function leave(group: GroupSummary) {
    setBusyId(group.id);
    setRowError("");
    setRowId(group.id);
    const saved = await postGroup(`/api/groups/${group.id}/leave`, {});
    setBusyId("");
    if (!saved.ok) {
      setRowError(saved.error);
      return;
    }
    setRowId("");
    setGroups((current) =>
      (current ?? []).map((item) =>
        item.id === group.id ? { ...item, joined: false } : item,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <FormAlert message={loadError} />
      {groups === null ? <p className="text-sm text-muted">Loading groups.</p> : null}
      {groups?.length === 0 ? <p className="text-sm text-muted">No groups yet.</p> : null}
      <ul className="grid gap-3 lg:grid-cols-2">
        {(groups ?? []).map((group) => (
          <li key={group.id} className="rounded-lg border border-line bg-surface p-4">
            <button
              type="button"
              className="inline-flex min-h-[44px] items-center rounded-sm bg-raised px-3 text-left text-2xl text-fg"
              onClick={() => onOpen(group.id)}
            >
              {group.name}
            </button>
            <RoomAudienceMark audience={group.audience} />
            {group.inviteFrom && !group.joined ? (
              <p className="mt-1 text-sm text-muted">Invite from {group.inviteFrom}</p>
            ) : null}
            <p className="mt-2 max-w-prose text-base text-muted">{group.about}</p>
            {group.joined ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnQuiet}
                  aria-busy={busyId === group.id}
                  aria-disabled={busyId === group.id || undefined}
                  onClick={() => {
                    if (busyId === group.id) return;
                    void leave(group);
                  }}
                >
                  Leave group
                </button>
              </div>
            ) : null}
            {rowId === group.id ? <FormAlert message={rowError} /> : null}
          </li>
        ))}
      </ul>
      <RequestGroup rooms={joinedRooms(home)} onSaved={() => setTick((value) => value + 1)} />
      <RequestDecisions
        requests={requests}
        canDecide={canDecide}
        onSaved={() => setTick((value) => value + 1)}
      />
    </div>
  );
}

function RequestGroup({
  rooms,
  onSaved,
}: {
  rooms: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!roomId && rooms[0]) setRoomId(rooms[0].id);
  }, [roomId, rooms]);

  return (
    <details className="max-w-xl rounded-lg border border-line bg-surface p-4">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-lg text-fg">
        Request a group
      </summary>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setBusy(true);
          void postGroup("/api/group-requests", { name, about, roomId }).then((result) => {
            setBusy(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setName("");
            setAbout("");
            onSaved();
          });
        }}
      >
        <p className="max-w-prose text-sm text-muted">
          A steward of a room you have joined approves it. Asking does not create the group, and the
          new group is not placed above the others.
        </p>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Name
          <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          What it is
          <textarea
            className={cn(fieldClass, "min-h-24")}
            value={about}
            onChange={(event) => setAbout(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Room
          <select
            className={fieldClass}
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
          >
            {rooms.length === 0 ? <option value="">No rooms yet. Ask a member of a room for an invite.</option> : null}
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </label>
        <FormAlert message={error} />
        <button type="submit" className={cn(btnSignal, "self-start")} aria-busy={busy} disabled={busy}>
          {busy ? "Saving…" : "Request"}
        </button>
      </form>
    </details>
  );
}

function RequestDecisions({
  requests,
  canDecide,
  onSaved,
}: {
  requests: GroupRequestRow[];
  canDecide: boolean;
  onSaved: () => void;
}) {
  const open = requests.filter((request) => request.status === "open");
  if (open.length === 0) return null;
  return (
    <details open className="max-w-xl rounded-lg border border-line bg-surface p-4">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-lg text-fg">Decide</summary>
      <ul className="mt-3 flex flex-col gap-4">
        {open.map((request) => (
          <RequestRow key={request.id} request={request} canDecide={canDecide} onSaved={onSaved} />
        ))}
      </ul>
    </details>
  );
}

function RequestRow({
  request,
  canDecide,
  onSaved,
}: {
  request: GroupRequestRow;
  canDecide: boolean;
  onSaved: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approved" | "refused") {
    setError("");
    setBusy(true);
    const saved = await postGroup(`/api/group-requests/${request.id}`, { decision, note });
    setBusy(false);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    onSaved();
  }

  return (
    <li className="flex flex-col gap-2">
      <p className="text-lg text-fg">{request.name}</p>
      <p className="text-[0.8125rem] text-muted">
        {request.by} · {request.roomId}
      </p>
      {canDecide ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label className="flex flex-col gap-2 text-sm text-muted">
            Decision note
            <input className={fieldClass} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <FormAlert message={error} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnGhost}
              aria-busy={busy}
              disabled={busy}
              onClick={() => void decide("approved")}
            >
              Approve
            </button>
            <button
              type="button"
              className={btnGhost}
              aria-busy={busy}
              disabled={busy}
              onClick={() => void decide("refused")}
            >
              Refuse
            </button>
          </div>
        </form>
      ) : (
        <p className="text-[0.8125rem] text-muted">Waiting for a steward of that room.</p>
      )}
    </li>
  );
}

function GroupDetailView({
  id,
  canDecide,
  onBack,
}: {
  id: string;
  canDecide: boolean;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [appeals, setAppeals] = useState<GroupAppealRow[]>([]);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [on, setOn] = useState("");
  const [postError, setPostError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((value) => value + 1);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [joinedNote, setJoinedNote] = useState("");

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const [loaded, asked] = await Promise.all([fetchGroup(id), fetchGroupAppeals()]);
      if (cancel) return;
      if (!loaded.ok) {
        setError(loaded.error);
        setDetail(null);
        return;
      }
      setDetail(loaded.value);
      setAppeals(asked.ok ? asked.value.filter((appeal) => appeal.groupId === id) : []);
      setError(asked.ok ? "" : asked.error);
    })();
    return () => {
      cancel = true;
    };
  }, [id, tick]);

  async function publish(event: FormEvent) {
    event.preventDefault();
    setPostError("");
    setBusy(true);
    const saved = await postGroup(`/api/groups/${id}/posts`, { body, on });
    setBusy(false);
    if (!saved.ok) {
      setPostError(saved.error);
      return;
    }
    setBody("");
    setOn("");
    reload();
  }

  async function older() {
    if (!detail?.next) return;
    setBusy(true);
    const more = await fetchGroup(id, detail.next);
    setBusy(false);
    if (!more.ok) {
      setError(more.error);
      return;
    }
    setDetail((current) => {
      if (!current) return more.value;
      const seen = new Set(current.posts.map((post) => post.id));
      return {
        ...more.value,
        posts: [...current.posts, ...more.value.posts.filter((post) => !seen.has(post.id))],
        marks: [...current.marks, ...more.value.marks],
      };
    });
  }

  const line = detail ? runByLine(detail.group.admins) : "";
  const canPost = Boolean(detail && (detail.group.joined || detail.group.admin));
  const canModerate = Boolean(detail && (detail.group.admin || canDecide));
  const openAppeals = appeals.filter((appeal) => appeal.status === "open");

  return (
    <div className="flex flex-col gap-6">
      <button type="button" className={cn(btnGhost, "self-start")} onClick={onBack}>
        All groups
      </button>
      <FormAlert message={error} />
      {detail ? (
        <>
          <header className="flex flex-col gap-2">
            <h2 ref={headingRef} tabIndex={-1} className="text-3xl text-fg">
              {detail.group.name}
            </h2>
            <p role="status" className="text-sm text-muted">
              {joinedNote}
            </p>
            <RoomAudienceMark audience={detail.group.audience} />
            <p className="max-w-prose text-base text-muted">{detail.group.about}</p>
            {line ? <p className="text-[0.8125rem] text-muted">{line}</p> : null}
          </header>
          {canPost ? (
            <form className="flex max-w-xl flex-col gap-3" onSubmit={(event) => void publish(event)}>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Post
                <textarea
                  className={cn(fieldClass, "min-h-24")}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Date, if there is one
                <input
                  type="date"
                  className={cn(fieldClass, "max-w-xs")}
                  value={on}
                  onChange={(event) => setOn(event.target.value)}
                />
              </label>
              <FormAlert message={postError} />
              <button type="submit" className={cn(btnSignal, "self-start")} aria-busy={busy} disabled={busy}>
                {busy ? "Saving…" : "Post"}
              </button>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">{GROUP_INVITE_ONLY}</p>
              {detail.group.invited ? (
                <AcceptInvite
                  groupId={id}
                  inviter={detail.group.invitedBy || "A group admin"}
                  onJoined={() => {
                    setJoinedNote(`You joined ${detail.group.name}. You can post here now.`);
                    reload();
                    headingRef.current?.focus();
                  }}
                />
              ) : null}
            </div>
          )}
          {detail.group.canInvite ? <InviteForm groupId={id} /> : null}
          <ul className="flex max-w-2xl flex-col gap-4">
            {detail.posts.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                canModerate={canModerate}
                onChanged={() => void reload()}
              />
            ))}
          </ul>
          {detail.removals.length > 0 ? (
            <section className="flex max-w-2xl flex-col gap-3">
              <h3 className="text-2xl text-fg">Removed</h3>
              <ul className="flex flex-col gap-3">
                {detail.removals.map((removal) => (
                  <RemovalRow key={removal.id} removal={removal} onChanged={() => void reload()} />
                ))}
              </ul>
            </section>
          ) : null}
          {detail.next ? (
            <button type="button" className={cn(btnGhost, "self-start")} aria-busy={busy} onClick={() => void older()}>
              Older
            </button>
          ) : null}
          {canDecide && openAppeals.length > 0 ? (
            <section className="flex max-w-xl flex-col gap-3">
              <h3 className="text-2xl text-fg">Appeals</h3>
              <ul className="flex flex-col gap-4">
                {openAppeals.map((appeal) => (
                  <AppealDecision key={appeal.id} appeal={appeal} onChanged={() => void reload()} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PostRow({
  post,
  canModerate,
  onChanged,
}: {
  post: GroupPostRow;
  canModerate: boolean;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState<HardRule | "">("");
  const [sentence, setSentence] = useState("");
  const [markError, setMarkError] = useState("");
  const [removeError, setRemoveError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [appeal, setAppeal] = useState("");
  const [appealError, setAppealError] = useState("");
  const [busy, setBusy] = useState(false);

  async function mark(value: "sloppy" | "unsupported") {
    setMarkError("");
    setBusy(true);
    const saved = await postGroup(`/api/group-posts/${post.id}/mark`, {
      mark: value,
      reason: sentence,
    });
    setBusy(false);
    if (!saved.ok) {
      setMarkError(saved.error);
      return;
    }
    setSentence("");
    onChanged();
  }

  async function sendAppeal(event: FormEvent) {
    event.preventDefault();
    setAppealError("");
    setBusy(true);
    const saved = await postGroup(`/api/group-posts/${post.id}/appeal`, { text: appeal });
    setBusy(false);
    if (!saved.ok) {
      setAppealError(saved.error);
      return;
    }
    setAppeal("");
    onChanged();
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <p className="text-base text-fg">{post.body}</p>
      <p className="text-[0.8125rem] text-muted">
        {post.author}
        {post.on ? ` · ${post.on}` : ""}
        {post.mark ? ` · ${MARK_LABEL[post.mark]}` : ""}
      </p>
      {post.mark ? (
        <form className="flex flex-col gap-2" onSubmit={(event) => void sendAppeal(event)}>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Why this should be lifted
            <textarea
              className={cn(fieldClass, "min-h-20")}
              value={appeal}
              onChange={(event) => setAppeal(event.target.value)}
            />
          </label>
          <FormAlert message={appealError} />
          <button type="submit" className={cn(btnGhost, "self-start")} aria-busy={busy} disabled={busy}>
            Appeal
          </button>
        </form>
      ) : null}
      {canModerate ? (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <label className="flex flex-col gap-2 text-sm text-muted">
              Why this mark
              <input
                className={fieldClass}
                value={sentence}
                onChange={(event) => setSentence(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btnGhost}
                aria-busy={busy}
                disabled={busy}
                onClick={() => void mark("sloppy")}
              >
                {MARK_LABEL.sloppy}
              </button>
              <button
                type="button"
                className={btnGhost}
                aria-busy={busy}
                disabled={busy}
                onClick={() => void mark("unsupported")}
              >
                {MARK_LABEL.unsupported}
              </button>
            </div>
            <FormAlert message={markError} />
          </form>
          <fieldset className="flex flex-col gap-1">
            <legend>Remove for</legend>
            {RULES.map((rule) => (
              <label key={rule} className="flex min-h-[44px] items-center gap-3 text-sm text-muted">
                <input
                  type="radio"
                  className="size-5"
                  name={`remove-${post.id}`}
                  checked={reason === rule}
                  onChange={() => setReason(rule)}
                />
                {RULE_LABEL[rule]}
              </label>
            ))}
          </fieldset>
          <FormAlert message={removeError} />
          <button
            type="button"
            className={cn(btnGhost, "self-start")}
            disabled={!reason || busy}
            onClick={() => {
              if (reason) setConfirmRemove(true);
            }}
          >
            Remove
          </button>
          <ConfirmDialog
            open={confirmRemove}
            title="Remove this post?"
            description={reason ? RULE_SENTENCE[reason] : ""}
            confirmLabel="Remove"
            cancelLabel="Keep it"
            onConfirm={() => {
              if (!reason) return;
              setConfirmRemove(false);
              setRemoveError("");
              setBusy(true);
              void postGroup(`/api/group-posts/${post.id}/remove`, { reason }).then((saved) => {
                setBusy(false);
                if (!saved.ok) {
                  setRemoveError(saved.error);
                  return;
                }
                onChanged();
              });
            }}
            onCancel={() => setConfirmRemove(false)}
          />
        </div>
      ) : null}
    </li>
  );
}

function RemovalRow({ removal, onChanged }: { removal: GroupRemovalRow; onChanged: () => void }) {
  const [appeal, setAppeal] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-4">
      <p className="text-[0.8125rem] text-muted">
        {removal.author} · {RULE_LABEL[removal.reason]}
      </p>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setBusy(true);
          void postGroup(`/api/group-posts/${removal.postId}/appeal`, { text: appeal }).then((saved) => {
            setBusy(false);
            if (!saved.ok) {
              setError(saved.error);
              return;
            }
            setAppeal("");
            onChanged();
          });
        }}
      >
        <label className="flex flex-col gap-2 text-sm text-muted">
          Why this should be lifted
          <textarea
            className={cn(fieldClass, "min-h-20")}
            value={appeal}
            onChange={(event) => setAppeal(event.target.value)}
          />
        </label>
        <FormAlert message={error} />
        <button type="submit" className={cn(btnGhost, "self-start")} aria-busy={busy} disabled={busy}>
          Appeal
        </button>
      </form>
    </li>
  );
}

function AppealDecision({ appeal, onChanged }: { appeal: GroupAppealRow; onChanged: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision: "upheld" | "lifted") {
    setError("");
    setBusy(true);
    const saved = await postGroup(`/api/group-appeals/${appeal.id}`, { decision });
    setBusy(false);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    onChanged();
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-4">
      <p className="text-base text-fg">{appeal.text}</p>
      <p className="text-[0.8125rem] text-muted">{appeal.by}</p>
      <FormAlert message={error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btnGhost}
          aria-busy={busy}
          disabled={busy}
          onClick={() => void decide("upheld")}
        >
          Upheld
        </button>
        <button
          type="button"
          className={btnGhost}
          aria-busy={busy}
          disabled={busy}
          onClick={() => void decide("lifted")}
        >
          Lifted
        </button>
      </div>
    </li>
  );
}

/** A member who holds an open invite joins or declines here. */
function AcceptInvite({
  groupId,
  inviter,
  onJoined,
}: {
  groupId: string;
  inviter: string;
  onJoined: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [declined, setDeclined] = useState(false);
  async function answer(path: "join" | "decline") {
    if (busy) return;
    setBusy(true);
    setError("");
    const saved = await postGroup(`/api/groups/${groupId}/${path}`, {});
    setBusy(false);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    if (path === "decline") setDeclined(true);
    else onJoined();
  }
  if (declined) {
    return (
      <p role="status" className="text-sm text-muted">
        Invite declined.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">{inviter} invited you to join this group.</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btnSignal}
          aria-busy={busy}
          aria-disabled={busy || undefined}
          onClick={() => void answer("join")}
        >
          {busy ? "Saving…" : "Accept invite"}
        </button>
        <button
          type="button"
          className={btnGhost}
          aria-disabled={busy || undefined}
          onClick={() => void answer("decline")}
        >
          Decline
        </button>
      </div>
      <FormAlert message={error} />
    </div>
  );
}

function inviteDate(at: number): string {
  return new Date(at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Group admins and stewards invite a member by email, and revoke an open invite. */
function InviteForm({ groupId }: { groupId: string }) {
  const [invites, setInvites] = useState<GroupInviteRow[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [listError, setListError] = useState("");
  const [revoking, setRevoking] = useState<GroupInviteRow | null>(null);
  const [tick, setTick] = useState(0);
  const fieldRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const loaded = await fetchGroupInvites(groupId);
      if (cancel) return;
      if (!loaded.ok) {
        setListError(loaded.error);
        return;
      }
      setInvites(loaded.value);
    })();
    return () => {
      cancel = true;
    };
  }, [groupId, tick]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNote("");
    const sentTo = email.trim();
    const saved = await postGroup(`/api/groups/${groupId}/invites`, { email: sentTo });
    setBusy(false);
    if (!saved.ok) {
      setError(saved.error);
      fieldRef.current?.focus();
      return;
    }
    setEmail("");
    setNote(`Invite sent to ${sentTo}.`);
    fieldRef.current?.focus();
    setTick((value) => value + 1);
  }

  async function revoke(invite: GroupInviteRow) {
    if (busy) return;
    setBusy(true);
    setListError("");
    setNote("");
    const saved = await postGroup(`/api/groups/${groupId}/invites/${invite.id}/revoke`, {});
    setBusy(false);
    if (!saved.ok) {
      setListError(saved.error);
      return;
    }
    setNote("Invite revoked.");
    openRef.current?.focus();
    setTick((value) => value + 1);
  }

  return (
    <section className="flex max-w-xl flex-col gap-3" aria-labelledby="group-invite-heading">
      <h3 id="group-invite-heading" className="text-xl text-fg">
        Invite a member
      </h3>
      <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void send(event)}>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Member's email (required)
          <input
            ref={fieldRef}
            type="email"
            required
            aria-required="true"
            aria-invalid={error ? true : undefined}
            aria-describedby="group-invite-help"
            className={cn(fieldClass, "min-h-[44px]")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <p id="group-invite-help" className="text-[0.8125rem] text-muted">
          They'll see the invite on this group's page and in their Groups list the next time they
          sign in. Nothing is emailed.
        </p>
        <FormAlert message={error} />
        <button
          type="submit"
          className={cn(btnSignal, "self-start")}
          aria-busy={busy}
          aria-disabled={busy || undefined}
        >
          {busy ? "Saving…" : "Send invite"}
        </button>
      </form>
      <p role="status" className="text-sm text-muted">
        {note}
      </p>
      <h3 ref={openRef} tabIndex={-1} className="text-xl text-fg">
        Open invites
      </h3>
      <FormAlert message={listError} />
      {invites !== null && invites.length === 0 ? (
        <p className="text-sm text-muted">No open invites.</p>
      ) : null}
      {invites && invites.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {invites.map((invite) => {
            const name = invite.name || "Member";
            const date = inviteDate(invite.at);
            return (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 text-sm text-muted">
                <span>
                  {name}, invited {date} by {invite.by}
                </span>
                <button
                  type="button"
                  className={btnGhost}
                  aria-label={`Revoke invite for ${name}, ${date}`}
                  aria-disabled={busy || undefined}
                  onClick={() => {
                    if (busy) return;
                    setRevoking(invite);
                  }}
                >
                  Revoke invite
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this invite?"
        description={`${revoking?.name || "Member"} won't be able to join with it. You can invite them again later.`}
        confirmLabel="Revoke invite"
        cancelLabel="Cancel"
        tone="danger"
        cancelFirst
        onConfirm={() => {
          const invite = revoking;
          setRevoking(null);
          if (invite) void revoke(invite);
        }}
        onCancel={() => setRevoking(null)}
      />
    </section>
  );
}
