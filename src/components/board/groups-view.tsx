import { useMemo, useState } from "react";
import { btnGhost, btnQuiet, btnSignal, fieldClass, Kicker, When } from "@/components/quorum/bits";
import { isRoomSteward } from "@/lib/board/access";
import { groupFeed } from "@/lib/board/groups";
import { MARK_LABEL, RULE_LABEL, authorName, formatDate, formatWhen, type HardRule, type Mark } from "@/lib/board/model";
import { directoryRooms, localRoomLabel } from "@/lib/board/places";
import { useBoard } from "@/lib/board/store";

const MARKS: Mark[] = ["sloppy", "unsupported"];
const RULES = Object.keys(RULE_LABEL) as HardRule[];

/**
 * Interest groups beside the town and church rooms. Join and leave.
 * The group admin marks or hard-removes. Stewards decide appeals.
 * The list is alphabetical. Nothing here is liked, reshared, or scored.
 */
export function GroupsView() {
  const openGroup = useBoard((state) => state.openGroup);
  const groups = useBoard((state) => state.groups);
  const ordered = useMemo(() => [...groups].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), [groups]);

  if (openGroup) return <GroupDetail />;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <Kicker>Groups</Kicker>
        <h1 className="font-display text-4xl text-fg lg:text-5xl">Interest groups</h1>
        <p className="max-w-prose text-base text-muted">
          Carpentry, gardening, brewing, a literary society, Christian-run businesses, and whatever a member asks for next. They sit beside town rooms and church rooms. Join one and its upcoming gathering shows with the rooms you've joined. A group admin moderates that group. There is nothing to like and nothing is ranked. The app is in English, and there is no language setting.
        </p>
      </section>
      <ul className="grid gap-3 lg:grid-cols-2">
        {ordered.map((group) => (
          <li key={group.id}>
            <GroupRow id={group.id} />
          </li>
        ))}
      </ul>
      <NewGroup />
      <GroupRequests />
    </div>
  );
}

function GroupRow({ id }: { id: string }) {
  const group = useBoard((state) => state.groups.find((item) => item.id === id));
  const joined = useBoard((state) => state.joined.some((place) => place.kind === "group" && place.id === id));
  const joinPlace = useBoard((state) => state.joinPlace);
  const leavePlace = useBoard((state) => state.leavePlace);
  const setOpenGroup = useBoard((state) => state.setOpenGroup);
  if (!group) return null;
  return (
    <article className="flex h-full flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div>
        <h2 className="text-2xl text-fg">{group.name}</h2>
        <p className="mt-1 text-sm text-muted">{group.about}</p>
        <p className="mt-1 text-xs text-muted">Admin: {group.admin}</p>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <button type="button" className={btnSignal} onClick={() => setOpenGroup(group.id)}>
          Open
        </button>
        <button type="button" className={joined ? btnQuiet : btnGhost} onClick={() => (joined ? leavePlace({ kind: "group", id: group.id }) : joinPlace({ kind: "group", id: group.id }))}>
          {joined ? "Leave" : "Join"}
        </button>
      </div>
    </article>
  );
}

function NewGroup() {
  const requestGroup = useBoard((state) => state.requestGroup);
  const joined = useBoard((state) => state.joined);
  const extra = useBoard((state) => state.extraTownRooms);
  const rooms = useMemo(() => {
    const ids = new Set(joined.flatMap((place) => (place.kind === "room" ? [place.id] : [])));
    return directoryRooms(extra).filter((room) => ids.has(room.id));
  }, [extra, joined]);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [error, setError] = useState("");
  return (
    <form
      className="flex max-w-xl flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const result = requestGroup(name, about, roomId);
        setError(result.ok ? "" : result.error);
        if (result.ok) {
          setName("");
          setAbout("");
        }
      }}
    >
      <h2 className="text-2xl text-fg">Ask for a group</h2>
      <p className="text-sm text-muted">A steward of a room you have joined approves it. You become the admin. Asking does not create the group, and the new group is not ranked above the others.</p>
      <label className="flex flex-col gap-2 text-sm text-muted">
        Name
        <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} aria-label="Group name" />
      </label>
      <label className="flex flex-col gap-2 text-sm text-muted">
        What it is
        <textarea className={fieldClass + " min-h-20"} value={about} onChange={(event) => setAbout(event.target.value)} aria-label="Group description" />
      </label>
      <label className="flex flex-col gap-2 text-sm text-muted">
        Your room
        <select className={fieldClass} value={roomId} onChange={(event) => setRoomId(event.target.value)} aria-label="Room for the group request">
          {rooms.length === 0 ? <option value="">Join a room first</option> : null}
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {localRoomLabel(room)}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="text-sm text-signal">{error}</p> : null}
      <button type="submit" className={btnSignal + " self-start"}>
        Request
      </button>
    </form>
  );
}

function GroupRequests() {
  const requests = useBoard((state) => state.groupRequests);
  const accessLog = useBoard((state) => state.accessLog);
  const me = useBoard((state) => authorName(state.me));
  const decideGroupRequest = useBoard((state) => state.decideGroupRequest);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  if (requests.length === 0) return null;
  return (
    <section className="flex max-w-xl flex-col gap-3">
      <h2 className="text-2xl text-fg">Group requests</h2>
      <p className="text-sm text-muted">A steward of the requester's room writes the decision. The row stays.</p>
      <label className="flex flex-col gap-2 text-sm text-muted">
        Decision note
        <input className={fieldClass} value={note} onChange={(event) => setNote(event.target.value)} aria-label="Group decision" />
      </label>
      {error ? <p className="text-sm text-signal">{error}</p> : null}
      <ul className="flex flex-col gap-2">
        {requests.map((request) => {
          const canDecide = request.status === "open" && me !== request.by && isRoomSteward(accessLog, me, request.roomId);
          return (
            <li key={request.id} className="rounded-md border border-line px-3 py-2 text-sm">
              <span className="text-fg">{request.name}</span>
              <span className="text-muted">
                {" "}
                · asked by {request.by} · {request.status}
                {request.note ? ` · ${request.note}` : ""}
                {request.decidedBy ? ` · ${request.decidedBy}` : ""}
              </span>
              {canDecide ? (
                <span className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className={btnSignal}
                    onClick={() => {
                      const result = decideGroupRequest(request.id, "approved", note);
                      setError(result.ok ? "" : result.error);
                    }}
                  >
                    Approve group
                  </button>
                  <button
                    type="button"
                    className={btnQuiet}
                    onClick={() => {
                      const result = decideGroupRequest(request.id, "refused", note);
                      setError(result.ok ? "" : result.error);
                    }}
                  >
                    Refuse
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GroupDetail() {
  const openGroup = useBoard((state) => state.openGroup);
  const setOpenGroup = useBoard((state) => state.setOpenGroup);
  const group = useBoard((state) => state.groups.find((item) => item.id === openGroup));
  const notes = useBoard((state) => state.groupNotes);
  const log = useBoard((state) => state.groupLog);
  const appeals = useBoard((state) => state.groupAppeals);
  const me = useBoard((state) => authorName(state.me));
  const steward = useBoard((state) => state.steward);
  const joined = useBoard((state) => state.joined.some((place) => place.kind === "group" && place.id === openGroup));
  const feed = useMemo(() => (group ? groupFeed(notes, group.id) : []), [group, notes]);
  const hidden = useMemo(() => notes.filter((note) => note.groupId === group?.id && note.removed && (note.author === me || group?.admin === me || steward)), [group, me, notes, steward]);
  const mineAppeals = appeals.filter((appeal) => appeal.groupId === group?.id && appeal.status === "open");
  if (!group) return null;
  const isAdmin = me === group.admin;
  return (
    <div className="flex flex-col gap-6 lg:max-w-3xl">
      <div className="flex flex-col gap-2">
        <button type="button" className={btnQuiet + " self-start px-0"} onClick={() => setOpenGroup(null)}>
          All groups
        </button>
        <Kicker>Group</Kicker>
        <h1 className="font-display text-4xl text-fg">{group.name}</h1>
        <p className="max-w-prose text-base text-muted">{group.about}</p>
        <p className="text-sm text-muted">Admin: {group.admin}. Notes are in time order, newest first. A mark stays on the note. It does not move it.</p>
      </div>
      {joined || isAdmin ? <NoteForm groupId={group.id} /> : <p className="text-sm text-muted">Join the group to post.</p>}
      <section className="flex flex-col divide-y divide-line">
        {feed.map((note) => (
          <NoteCard key={note.id} noteId={note.id} isAdmin={isAdmin} />
        ))}
        {hidden.map((note) => (
          <NoteCard key={note.id} noteId={note.id} isAdmin={isAdmin} />
        ))}
        {feed.length === 0 && hidden.length === 0 ? <p className="py-4 text-sm text-muted">Nothing posted here yet.</p> : null}
      </section>
      <Log rows={log.filter((row) => row.groupId === group.id).slice(0, 20)} />
      {steward && mineAppeals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl text-fg">Appeals for the stewards</h2>
          {mineAppeals.map((appeal) => (
            <AppealRow key={appeal.id} appealId={appeal.id} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function NoteForm({ groupId }: { groupId: string }) {
  const fileGroupNote = useBoard((state) => state.fileGroupNote);
  const [body, setBody] = useState("");
  const [on, setOn] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const result = fileGroupNote(groupId, body, on);
        setError(result.ok ? "" : result.error);
        if (result.ok) {
          setBody("");
          setOn("");
        }
      }}
    >
      <label className="flex flex-col gap-2 text-sm text-muted">
        A note
        <textarea className={fieldClass + " min-h-20"} value={body} onChange={(event) => setBody(event.target.value)} />
      </label>
      <label className="flex flex-col gap-2 text-sm text-muted">
        Gathering date, if this is one. A date inside seven days shows on Home for members who joined.
        <input type="date" className={fieldClass} value={on} onChange={(event) => setOn(event.target.value)} />
      </label>
      {error ? <p className="text-sm text-signal">{error}</p> : null}
      <button type="submit" className={btnSignal + " self-start"}>
        Post
      </button>
    </form>
  );
}

function NoteCard({ noteId, isAdmin }: { noteId: string; isAdmin: boolean }) {
  const note = useBoard((state) => state.groupNotes.find((item) => item.id === noteId));
  const me = useBoard((state) => authorName(state.me));
  const markGroupNote = useBoard((state) => state.markGroupNote);
  const removeGroupNote = useBoard((state) => state.removeGroupNote);
  const appeal = useBoard((state) => state.appealGroupNote);
  const openAppeal = useBoard((state) => state.groupAppeals.find((item) => item.noteId === noteId && item.status === "open"));
  const [appealText, setAppealText] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  if (!note) return null;
  return (
    <article className="py-4">
      <p className="text-xs text-muted">
        {note.author} · <When at={note.at} format={formatWhen} />
        {note.on ? ` · ${formatDate(note.on)}` : ""}
        {note.mark ? ` · ${MARK_LABEL[note.mark]}` : ""}
        {note.removed && note.removedFor ? ` · Removed: ${RULE_LABEL[note.removedFor]}` : ""}
      </p>
      <p className="mt-2 max-w-prose text-base text-fg">{note.body}</p>
      {isAdmin && !note.removed ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {MARKS.map((item) => (
            <button key={item} type="button" className={btnQuiet} onClick={() => markGroupNote(note.id, note.mark === item ? null : item)}>
              {note.mark === item ? `Clear ${MARK_LABEL[item].toLowerCase()}` : MARK_LABEL[item]}
            </button>
          ))}
          {removing ? (
            <>
              {RULES.map((rule) => (
                <button key={rule} type="button" className={btnGhost} onClick={() => removeGroupNote(note.id, rule)}>
                  Remove: {RULE_LABEL[rule]}
                </button>
              ))}
              <button type="button" className={btnQuiet} onClick={() => setRemoving(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className={btnQuiet} onClick={() => setRemoving(true)}>
              Remove note
            </button>
          )}
        </div>
      ) : null}
      {me === note.author && (note.mark || note.removed) ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const result = appeal(note.id, appealText);
            setError(result.ok ? "" : result.error);
            if (result.ok) setAppealText("");
          }}
        >
          {openAppeal ? <p className="text-sm text-muted">Appeal with the stewards: {openAppeal.text}</p> : null}
          {openAppeal ? null : (
            <>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Appeal to the stewards
                <input className={fieldClass} value={appealText} onChange={(event) => setAppealText(event.target.value)} />
              </label>
              <button type="submit" className={btnQuiet + " self-start"}>
                Send appeal
              </button>
            </>
          )}
          {error ? <p className="text-sm text-signal">{error}</p> : null}
        </form>
      ) : null}
    </article>
  );
}

function Log({ rows }: { rows: { id: string; by: string; action: string; mark: Mark | null; reason: string; at: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">Moderation log</h2>
      <ul className="flex flex-col gap-1 text-sm text-muted">
        {rows.map((row) => (
          <li key={row.id}>
            {row.by} {row.action === "remove" ? `removed a note (${row.reason})` : row.action === "clear" ? "cleared a mark" : `marked a note ${row.mark ?? row.reason}`} · <When at={row.at} format={formatWhen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AppealRow({ appealId }: { appealId: string }) {
  const appeal = useBoard((state) => state.groupAppeals.find((item) => item.id === appealId));
  const decide = useBoard((state) => state.decideGroupAppeal);
  const [error, setError] = useState("");
  if (!appeal) return null;
  const onDecide = (decision: "upheld" | "lifted") => {
    const result = decide(appeal.id, decision);
    setError(result.ok ? "" : result.error);
  };
  return (
    <article className="rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-fg">{appeal.text}</p>
      <p className="mt-1 text-xs text-muted">
        {appeal.by} · <When at={appeal.at} format={formatWhen} />
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <button type="button" className={btnQuiet} onClick={() => onDecide("upheld")}>
            Uphold
          </button>
          <button type="button" className={btnSignal} onClick={() => onDecide("lifted")}>
            Lift
          </button>
        </div>
        {error ? <p className="text-sm text-signal">{error}</p> : null}
      </div>
    </article>
  );
}
