import { useState } from "react";
import { btnQuiet, btnSignal, fieldClass } from "@/components/quorum/bits";
import { directoryRooms } from "@/lib/board/places";
import { useBoard } from "@/lib/board/store";

/** Charter rule 9 and town-room requests. The founding seat itself is on the door. */
export function AccessPanel() {
  const bootstrapped = useBoard((state) => state.bootstrapped);
  const admin = useBoard((state) => state.admin);
  const steward = useBoard((state) => state.steward);
  const accessLog = useBoard((state) => state.accessLog);
  const requests = useBoard((state) => state.townRoomRequests);
  const extra = useBoard((state) => state.extraTownRooms);
  const vouchMember = useBoard((state) => state.vouchMember);
  const appointSteward = useBoard((state) => state.appointSteward);
  const appointAdmin = useBoard((state) => state.appointAdmin);
  const requestTownRoom = useBoard((state) => state.requestTownRoom);
  const decideTownRoom = useBoard((state) => state.decideTownRoom);
  const rooms = directoryRooms(extra);
  const [error, setError] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberRoom, setMemberRoom] = useState(rooms[0]?.id ?? "");
  const [stewardName, setStewardName] = useState("");
  const [stewardRoom, setStewardRoom] = useState(rooms[0]?.id ?? "");
  const [inviter, setInviter] = useState("");
  const [adminName, setAdminName] = useState("");
  const [stewardApprover, setStewardApprover] = useState("");
  const [townName, setTownName] = useState("");
  const [townState, setTownState] = useState("");
  const [decisionNote, setDecisionNote] = useState("");

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">Access</h2>
      <p className="max-w-prose text-sm text-muted">
        {bootstrapped
          ? "Josh is the founding admin and council chair. That seat already ran, and it will not run again. Everyone after him is added in layers: a member needs one inviter, a steward needs that inviter plus a steward of the room (the council chair, if the room has no steward yet), and an admin needs a steward plus a role owner. Each grant is logged."
          : "Josh has not been seated yet. The door seats him once."}
      </p>
      {error ? <p className="text-sm text-signal">{error}</p> : null}

      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const result = vouchMember(memberName, memberRoom);
          setError(result.ok ? "" : result.error);
          if (result.ok) setMemberName("");
        }}
      >
        <label className="flex flex-col gap-2 text-sm text-muted">
          Vouch for a member
          <input className={fieldClass} value={memberName} onChange={(event) => setMemberName(event.target.value)} aria-label="New member" />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Room
          <select className={fieldClass} value={memberRoom} onChange={(event) => setMemberRoom(event.target.value)} aria-label="Room for the new member">
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={btnSignal}>
          Vouch
        </button>
      </form>

      <form
        className="grid gap-3 sm:grid-cols-4 sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const result = appointSteward(stewardName, stewardRoom, inviter);
          setError(result.ok ? "" : result.error);
          if (result.ok) setStewardName("");
        }}
      >
        <label className="flex flex-col gap-2 text-sm text-muted">
          Steward
          <input className={fieldClass} value={stewardName} onChange={(event) => setStewardName(event.target.value)} aria-label="New steward" />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Their room
          <select className={fieldClass} value={stewardRoom} onChange={(event) => setStewardRoom(event.target.value)} aria-label="Room for the steward">
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Inviter
          <input className={fieldClass} value={inviter} onChange={(event) => setInviter(event.target.value)} aria-label="Steward inviter" />
        </label>
        <button type="submit" className={btnSignal}>
          Approve steward
        </button>
      </form>

      {admin ? (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const result = appointAdmin(adminName, stewardApprover);
            setError(result.ok ? "" : result.error);
            if (result.ok) setAdminName("");
          }}
        >
          <label className="flex flex-col gap-2 text-sm text-muted">
            Admin
            <input className={fieldClass} value={adminName} onChange={(event) => setAdminName(event.target.value)} aria-label="New admin" />
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Steward who approved
            <input className={fieldClass} value={stewardApprover} onChange={(event) => setStewardApprover(event.target.value)} aria-label="Steward who approved the admin" />
          </label>
          <button type="submit" className={btnSignal}>
            Sign off
          </button>
        </form>
      ) : null}

      <form
        className="grid gap-3 sm:grid-cols-[1fr_6rem_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const result = requestTownRoom(townName, townState);
          setError(result.ok ? "" : result.error);
          if (result.ok) {
            setTownName("");
            setTownState("");
          }
        }}
      >
        <label className="flex flex-col gap-2 text-sm text-muted">
          Ask for a town room
          <input className={fieldClass} value={townName} onChange={(event) => setTownName(event.target.value)} aria-label="Town to request" placeholder="Seffner" />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          State
          <input className={fieldClass} value={townState} maxLength={2} onChange={(event) => setTownState(event.target.value)} aria-label="Town state" placeholder="FL" />
        </label>
        <button type="submit" className={btnSignal}>
          Request
        </button>
      </form>
      <p className="text-sm text-muted">A ZIP does not create a room. An admin or a steward approves the request, and the decision stays in the log.</p>
      {admin || steward ? (
        <label className="flex flex-col gap-2 text-sm text-muted">
          Decision note
          <input className={fieldClass} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} aria-label="Town room decision" />
        </label>
      ) : null}
      <ul className="flex flex-col gap-2">
        {requests.map((request) => (
          <li key={request.id} className="rounded-md border border-line px-3 py-2 text-sm">
            <span className="text-fg">
              {request.name}, {request.state}
            </span>
            <span className="text-muted">
              {" "}
              · asked by {request.by} · {request.status}
              {request.note ? ` · ${request.note}` : ""}
              {request.decidedBy ? ` · ${request.decidedBy}` : ""}
            </span>
            {request.status === "open" && (admin || steward) ? (
              <span className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={btnSignal}
                  onClick={() => {
                    const result = decideTownRoom(request.id, "approved", decisionNote);
                    setError(result.ok ? "" : result.error);
                  }}
                >
                  Approve room
                </button>
                <button
                  type="button"
                  className={btnQuiet}
                  onClick={() => {
                    const result = decideTownRoom(request.id, "refused", decisionNote);
                    setError(result.ok ? "" : result.error);
                  }}
                >
                  Refuse
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {accessLog.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold tracking-widest text-muted uppercase">Access log</h3>
          <ul className="flex flex-col gap-1 text-sm text-muted">
            {accessLog.slice(-12).map((row) => (
              <li key={row.id}>
                {row.action === "grant" ? "Granted" : "Revoked"} {row.role} for {row.name}
                {row.roomId ? ` in ${row.roomId}` : ""} · vouched by {row.vouchedBy}
                {row.approvedBy ? `, approved by ${row.approvedBy}` : ""} · {row.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
