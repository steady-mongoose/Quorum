import { useEffect, useRef, useState } from "react";
import { ClaimsPanel } from "@/components/board/claims-queue";
import { btnGhost, btnSignal, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import type { HomeRequest, HomeSection } from "@/lib/board/home";
import { useBoard } from "@/lib/board/store";
import { RoomAudienceMark } from "@/components/board/audience";

/**
 * Home is the server's list. Joined rooms, then the ZIP town, then the
 * congregation, then farther out. Council-approved posts sit above that.
 * This view does not sort.
 */
export function HomePanel() {
  const home = useBoard((state) => state.home);
  const setRoom = useBoard((state) => state.setRoom);
  const savePlace = useBoard((state) => state.savePlace);
  const requestRoom = useBoard((state) => state.requestRoom);
  const admin = useBoard((state) => state.admin);
  const [zip, setZip] = useState(home?.zip ?? "");
  const [congregationId, setCongregationId] = useState(home?.congregationId ?? "");
  const [kind, setKind] = useState<"town" | "congregation" | "region">("town");
  const [name, setName] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [placeError, setPlaceError] = useState("");
  const [requestError, setRequestError] = useState("");
  const requestRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    setZip(home?.zip ?? "");
    setCongregationId(home?.congregationId ?? "");
  }, [home?.zip, home?.congregationId]);

  if (!home) return null;

  const zipNote =
    home.zip && !home.townId
      ? `There is no town room for ZIP ${home.zip} yet. You can ask for one with Request a new place.`
      : home.townName
        ? `Your town room: ${home.townName}`
        : "";

  const openRequest = () => {
    const details = requestRef.current;
    if (!details) return;
    details.open = true;
    details.querySelector("summary")?.focus();
  };

  return (
    <section className="flex flex-col gap-6">
      <section className="plate flex flex-col gap-4" aria-labelledby="home-h">
        <div className="flex flex-col gap-2">
          <h2 id="home-h" className="font-display text-3xl text-fg">
            Your rooms, nearest first
          </h2>
          <p className="max-w-prose text-sm text-muted">
            Rooms you have joined, then your town, then your congregation, then the wider area. The
            order comes from where you are, not from activity or popularity. A post the council
            approved shows above them with a label.
          </p>
        </div>
        {home.sections.map((section) => (
          <HomeSectionBlock key={section.tier} section={section} onOpen={setRoom} />
        ))}
      </section>

      <form
        className="plate grid gap-4 sm:grid-cols-2"
        aria-labelledby="place-h"
        onSubmit={(event) => {
          event.preventDefault();
          setPlaceError("");
          void savePlace({ zip, congregationId }).then((result) => {
            if (!result.ok) setPlaceError(result.error ?? "That was not saved.");
          });
        }}
      >
        <div className="flex flex-col gap-1 sm:col-span-2">
          <h3 id="place-h" className="font-display text-2xl text-fg">
            Your place
          </h3>
          <p className="max-w-prose text-sm text-muted">
            Your ZIP sets your town room. Your congregation sets your church's room.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="place-zip" className="text-sm text-muted">
            ZIP
          </label>
          <input
            id="place-zip"
            className={fieldClass}
            inputMode="numeric"
            autoComplete="postal-code"
            aria-describedby="place-zip-note"
            value={zip}
            onChange={(event) => setZip(event.target.value)}
          />
          <p id="place-zip-note" className="text-sm text-muted" aria-live="polite">
            {zipNote}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="place-congregation" className="text-sm text-muted">
            Congregation
          </label>
          <select
            id="place-congregation"
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
        </div>
        <button
          type="submit"
          className={cn(btnSignal, "w-full justify-self-start sm:col-span-2 sm:w-auto")}
        >
          Save place
        </button>
        {placeError ? (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {placeError}
          </p>
        ) : null}
      </form>

      <details ref={requestRef} className="group flex flex-col">
        <summary className={cn(btnGhost, "w-fit list-none [&::-webkit-details-marker]:hidden")}>
          Request a new place
        </summary>
        <form
          className="plate mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setRequestError("");
            void requestRoom({ kind, name, state: stateCode }).then((result) => {
              if (!result.ok) {
                setRequestError(result.error ?? "That was not saved.");
                return;
              }
              setName("");
              setStateCode("");
            });
          }}
        >
          <p className="max-w-prose text-sm text-muted sm:col-span-2">
            Ask for a room for a town, a congregation, or a wider area. An admin approves it. The
            request stays on the record.
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
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted">
            State
            <input
              className={fieldClass}
              value={stateCode}
              onChange={(event) => setStateCode(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className={cn(btnSignal, "w-full justify-self-start sm:col-span-2 sm:w-auto")}
          >
            Request room
          </button>
          {requestError ? (
            <p role="alert" className="text-sm text-danger sm:col-span-2">
              {requestError}
            </p>
          ) : null}
        </form>
      </details>

      <ClaimsPanel onNotListed={openRequest} />

      {home.requests.length > 0 ? (
        <details className="rounded-lg border border-line bg-surface p-4" open>
          <summary className="flex min-h-[44px] cursor-pointer items-center text-lg text-fg">
            Decide
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {home.requests.map((request) => (
              <RequestRow key={request.id} request={request} admin={admin} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function HomeSectionBlock({
  section,
  onOpen,
}: {
  section: HomeSection;
  onOpen: (roomId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3">
      <h3 className="list-label">{section.label}</h3>
      {section.tier === "council" ? (
        section.posts.map((post) => (
          <article key={post.id} className="flex flex-col gap-1 py-2">
            <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
              <span className="rounded-sm border border-signal px-2 py-1 text-signal">
                {post.label}
              </span>
              <button
                type="button"
                className="inline-flex min-h-[44px] items-center text-signal underline"
                onClick={() => onOpen(post.room)}
              >
                {post.roomName}
              </button>
            </div>
            <p className="text-base text-fg">{post.claim}</p>
            <p className="text-sm text-muted">{post.reason}</p>
            <ul className="list-disc pl-5 text-sm text-muted">
              {post.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))
      ) : (
        <ul className="flex flex-col">
          {section.rooms.map((room) => (
            <RoomJoinRow
              key={room.id}
              roomId={room.id}
              name={room.name}
              audience={room.audience}
              joined={section.tier === "joined"}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** A room is a row with an underlined name that opens the room, not a bordered box that reads as a field. */
function RoomJoinRow({
  roomId,
  name,
  audience,
  joined,
  onOpen,
}: {
  roomId: string;
  name: string;
  audience?: "men" | "women";
  joined: boolean;
  onOpen: (roomId: string) => void;
}) {
  const leaveRoom = useBoard((state) => state.leaveRoom);
  const [error, setError] = useState("");

  return (
    <li className="room-row flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center gap-2 text-left text-base text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg"
          onClick={() => onOpen(roomId)}
        >
          {name} <RoomAudienceMark audience={audience} />
          <span aria-hidden="true" className="text-muted">
            →
          </span>
        </button>
        {joined ? (
          <button
            type="button"
            className={btnGhost}
            aria-label={`Leave ${name}`}
            onClick={() => {
              setError("");
              void leaveRoom(roomId).then((result) => {
                if (!result.ok) setError(result.error ?? "That was not saved.");
              });
            }}
          >
            Leave
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function RequestRow({ request, admin }: { request: HomeRequest; admin: boolean }) {
  const decideRoom = useBoard((state) => state.decideRoom);
  const [note, setNote] = useState("");
  const [stewardEmail, setStewardEmail] = useState("");
  const [inviterEmail, setInviterEmail] = useState("");
  const [error, setError] = useState("");

  const decide = (decision: "approved" | "refused") => {
    setError("");
    void decideRoom(request.id, { decision, note, stewardEmail, inviterEmail }).then((result) => {
      if (!result.ok) setError(result.error ?? "That decision was not saved.");
    });
  };

  return (
    <article className="rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-fg">
        {request.name}
        {request.state ? `, ${request.state}` : ""} · {request.kind} · {request.status}
      </p>
      <p className="text-[0.8125rem] text-muted">Asked by {request.by}</p>
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
          <p className="text-sm text-muted">
            To approve, name the room's first steward and the member who vouches for them.
          </p>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Steward email
            <input
              className={`${fieldClass} min-h-[44px]`}
              type="email"
              value={stewardEmail}
              onChange={(event) => setStewardEmail(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Email of the member who vouches for them
            <input
              className={`${fieldClass} min-h-[44px]`}
              type="email"
              value={inviterEmail}
              onChange={(event) => setInviterEmail(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${btnSignal} min-h-[44px]`}
              onClick={() => decide("approved")}
            >
              Approve
            </button>
            <button
              type="button"
              className={`${btnGhost} min-h-[44px]`}
              onClick={() => decide("refused")}
            >
              Refuse
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
