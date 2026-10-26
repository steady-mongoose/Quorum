import { useEffect, useState } from "react";
import { btnGhost, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import type { HomeRequest, HomeSection } from "@/lib/board/home";
import { useBoard } from "@/lib/board/store";

/**
 * Home is the server's list. Joined rooms, then the ZIP town, then the
 * congregation, then farther out. Council-approved posts sit above that.
 * This view does not sort.
 */
export function HomePanel() {
  const home = useBoard((state) => state.home);
  const setRoom = useBoard((state) => state.setRoom);
  const joinRoom = useBoard((state) => state.joinRoom);
  const leaveRoom = useBoard((state) => state.leaveRoom);
  const savePlace = useBoard((state) => state.savePlace);
  const requestRoom = useBoard((state) => state.requestRoom);
  const admin = useBoard((state) => state.admin);
  const [zip, setZip] = useState(home?.zip ?? "");
  const [congregationId, setCongregationId] = useState(home?.congregationId ?? "");
  const [kind, setKind] = useState<"town" | "congregation" | "region">("town");
  const [name, setName] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setZip(home?.zip ?? "");
    setCongregationId(home?.congregationId ?? "");
  }, [home?.zip, home?.congregationId]);

  if (!home) return null;

  const report = (result: { ok: boolean; error?: string }, ok: string) => {
    setMessage(result.ok ? ok : (result.error ?? "That was not saved."));
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Kicker>Home</Kicker>
        <h2 className="font-display text-3xl text-fg">Nearest first</h2>
        <p className="max-w-prose text-sm text-muted">
          Rooms you have joined, then your ZIP town, then your congregation, then farther out. A
          council approval is a label above those rooms. Nothing here is ranked.
        </p>
      </div>

      {home.sections.map((section) => (
        <HomeSectionBlock
          key={section.tier}
          section={section}
          onOpen={setRoom}
          onJoin={(roomId) => {
            void joinRoom(roomId).then((result) => report(result, "You joined that room."));
          }}
          onLeave={(roomId) => {
            void leaveRoom(roomId).then((result) => report(result, "You left that room."));
          }}
        />
      ))}

      <form
        className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void savePlace({ zip, congregationId }).then((result) =>
            report(result, "Your place is saved."),
          );
        }}
      >
        <h3 className="text-lg text-fg sm:col-span-2">Your place</h3>
        <label className="flex flex-col gap-2 text-sm text-muted">
          ZIP
          <input
            className={fieldClass}
            inputMode="numeric"
            value={zip}
            placeholder="33578"
            onChange={(event) => setZip(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Congregation
          <select
            className={fieldClass}
            value={congregationId}
            onChange={(event) => setCongregationId(event.target.value)}
          >
            <option value="">None</option>
            {home.congregations.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={btnSignal}>
          Save place
        </button>
      </form>

      <form
        className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void requestRoom({ kind, name, state: stateCode }).then((result) => {
            report(result, "The request is with the admins.");
            if (result.ok) {
              setName("");
              setStateCode("");
            }
          });
        }}
      >
        <h3 className="text-lg text-fg sm:col-span-2">Ask for a room</h3>
        <p className="max-w-prose text-sm text-muted sm:col-span-2">
          A town, a congregation, or a wider area. An admin approves it. The request stays on the
          record.
        </p>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Kind
          <select
            className={fieldClass}
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="town">Town</option>
            <option value="congregation">Congregation</option>
            <option value="region">Wider area</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Name
          <input
            className={fieldClass}
            value={name}
            placeholder="Seffner"
            onChange={(event) => setName(event.target.value)}
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
        <button type="submit" className={btnSignal}>
          Request room
        </button>
      </form>

      {home.requests.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-lg text-fg">Room requests</h3>
          {home.requests.map((request) => (
            <RequestRow key={request.id} request={request} admin={admin} onDone={setMessage} />
          ))}
        </div>
      ) : null}

      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </section>
  );
}

function HomeSectionBlock({
  section,
  onOpen,
  onJoin,
  onLeave,
}: {
  section: HomeSection;
  onOpen: (roomId: string) => void;
  onJoin: (roomId: string) => void;
  onLeave: (roomId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-widest text-muted uppercase">{section.label}</h3>
      {section.tier === "council"
        ? section.posts.map((post) => (
            <article key={post.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-sm border border-signal px-2 py-1 text-signal">
                  {post.label}
                </span>
                <button type="button" className="text-signal underline" onClick={() => onOpen(post.room)}>
                  {post.roomName}
                </button>
              </div>
              <p className="mt-2 text-base text-fg">{post.claim}</p>
              <p className="mt-1 text-sm text-muted">{post.reason}</p>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted">
                {post.checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))
        : section.rooms.map((room) => (
            <div
              key={room.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-4 py-3"
            >
              <button type="button" className="text-left text-base text-fg" onClick={() => onOpen(room.id)}>
                {room.name}
              </button>
              {section.tier === "joined" ? (
                <button type="button" className={btnGhost} onClick={() => onLeave(room.id)}>
                  Leave
                </button>
              ) : (
                <button type="button" className={btnGhost} onClick={() => onJoin(room.id)}>
                  Join
                </button>
              )}
            </div>
          ))}
    </div>
  );
}

function RequestRow({
  request,
  admin,
  onDone,
}: {
  request: HomeRequest;
  admin: boolean;
  onDone: (message: string) => void;
}) {
  const decideRoom = useBoard((state) => state.decideRoom);
  const [note, setNote] = useState("");

  const decide = (decision: "approved" | "refused") => {
    void decideRoom(request.id, { decision, note }).then((result) => {
      onDone(
        result.ok
          ? decision === "approved"
            ? "The room is up."
            : "The request was refused."
          : (result.error ?? "That decision was not saved."),
      );
    });
  };

  return (
    <article className="rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-fg">
        {request.name}
        {request.state ? `, ${request.state}` : ""} · {request.kind} · {request.status}
      </p>
      <p className="text-sm text-muted">Asked by {request.by}</p>
      {request.note ? <p className="mt-1 text-sm text-muted">{request.note}</p> : null}
      {admin && request.status === "open" ? (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex flex-col gap-2 text-sm text-muted">
            One sentence
            <input
              className={fieldClass}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSignal} onClick={() => decide("approved")}>
              Approve
            </button>
            <button type="button" className={btnGhost} onClick={() => decide("refused")}>
              Refuse
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
