import { useEffect, useRef, useState } from "react";
import { ClaimsPanel } from "@/components/board/claims-queue";
import { btnGhost, btnSignal, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import type { HomeRequest, HomeSection } from "@/lib/board/home";
import { useBoard } from "@/lib/board/store";
import { RoomAudienceMark } from "@/components/board/audience";

type SaveResult = { ok: boolean; error?: string };

/** The board's code for a barred account, said in words on the page. */
const BARRED = "This account is barred from the board.";

/**
 * Runs a save and always settles with words to show: a refusal keeps the server's reason,
 * and a dropped connection is a refusal too, never a silent no-op (Josh, Oct 30).
 */
export async function settleSave(
  run: () => Promise<SaveResult>,
  fallback: string,
): Promise<SaveResult> {
  try {
    const result = await run();
    if (result.ok) return { ok: true };
    const error = result.error === "banned" ? BARRED : result.error?.trim() || fallback;
    return { ok: false, error };
  } catch {
    return { ok: false, error: `${fallback} Check your connection and try again.` };
  }
}

/** What Save place says once the server keeps it. */
export function placeSavedText(input: { zip: string; congregationName: string }): string {
  const zip = input.zip.trim();
  const parts = [zip ? `ZIP ${zip}` : "no ZIP", input.congregationName || "no congregation"];
  return `Saved. Your place is ${parts.join(" and ")}.`;
}

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
  const [placeSaved, setPlaceSaved] = useState("");
  const [placeSaving, setPlaceSaving] = useState(false);
  const placeSavingRef = useRef(false);
  const [requestSending, setRequestSending] = useState(false);
  const requestSendingRef = useRef(false);
  const [leftNote, setLeftNote] = useState("");
  const [requestError, setRequestError] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSent, setRequestSent] = useState("");
  const kindRef = useRef<HTMLSelectElement>(null);
  const sentRef = useRef<HTMLParagraphElement>(null);
  const focusKind = useRef(false);

  useEffect(() => {
    setZip(home?.zip ?? "");
    setCongregationId(home?.congregationId ?? "");
  }, [home?.zip, home?.congregationId]);

  // Opening "Request a new place" moves focus to its first field (Kind), from the button or from the claim picker.
  useEffect(() => {
    if (requestOpen && focusKind.current) {
      focusKind.current = false;
      kindRef.current?.focus();
    }
  }, [requestOpen]);

  useEffect(() => {
    if (requestSent) sentRef.current?.focus();
  }, [requestSent]);

  if (!home) return null;

  const openRequest = () => {
    setRequestSent("");
    if (requestOpen) {
      kindRef.current?.focus();
      return;
    }
    focusKind.current = true;
    setRequestOpen(true);
  };

  // The ZIP note's way out is a real button that opens Request a new place on Kind (QA #123 S4).
  const zipNote =
    home.zip && !home.townId ? (
      <>
        There is no town room for ZIP {home.zip} yet.{" "}
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center text-fg underline underline-offset-4"
          aria-expanded={requestOpen}
          aria-controls="request-place-form"
          onClick={() => {
            setKind("town");
            openRequest();
          }}
        >
          Ask for one with Request a new place
        </button>
      </>
    ) : home.townName ? (
      `Your town room: ${home.townName}`
    ) : (
      ""
    );

  return (
    <section className="flex flex-col gap-6">
      <section className="card pc-card flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="home-h">
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
          <HomeSectionBlock
            key={section.tier}
            section={section}
            onOpen={setRoom}
            onLeft={(roomName) => setLeftNote(`You left ${roomName}.`)}
          />
        ))}
        {/* A room you leave drops out of Joined, so the result is said here, outside the row. */}
        <div role="status" aria-live="polite">
          {leftNote ? <p className="text-sm text-fg">{leftNote}</p> : null}
        </div>
      </section>

      <form
        className="card pc-card grid gap-4 p-4 sm:p-5 sm:grid-cols-2"
        aria-labelledby="place-h"
        onSubmit={(event) => {
          event.preventDefault();
          if (placeSavingRef.current) return;
          placeSavingRef.current = true;
          setPlaceSaving(true);
          setPlaceError("");
          setPlaceSaved("");
          const congregationName =
            home.congregations.find((row) => row.id === congregationId)?.name ?? "";
          const typedZip = zip;
          void settleSave(
            () => savePlace({ zip, congregationId }),
            "Your place was not saved.",
          ).then((result) => {
            placeSavingRef.current = false;
            setPlaceSaving(false);
            if (!result.ok) {
              setPlaceError(result.error ?? "Your place was not saved.");
              return;
            }
            setPlaceSaved(placeSavedText({ zip: typedZip, congregationName }));
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
            onChange={(event) => {
              setZip(event.target.value);
              setPlaceSaved("");
            }}
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
            onChange={(event) => {
              setCongregationId(event.target.value);
              setPlaceSaved("");
            }}
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
          aria-busy={placeSaving || undefined}
          className={cn(btnSignal, "w-full justify-self-start sm:col-span-2 sm:w-auto")}
        >
          {placeSaving ? "Saving…" : "Save place"}
        </button>
        {/* Mounted from the start so every Save is spoken and seen: saved, or the server's reason. */}
        <div role="status" aria-live="polite" className="sm:col-span-2">
          {placeError ? (
            <p className="text-sm text-danger">{placeError}</p>
          ) : placeSaved ? (
            <p className="text-sm text-fg">{placeSaved}</p>
          ) : null}
        </div>
      </form>

      <div className="flex flex-col">
        <button
          type="button"
          className={cn(btnGhost, "w-fit")}
          aria-expanded={requestOpen}
          aria-controls="request-place-form"
          onClick={() => {
            if (requestOpen) {
              setRequestOpen(false);
              return;
            }
            openRequest();
          }}
        >
          Request a new place
        </button>
        <div role="status">
          {requestSent ? (
            <p ref={sentRef} tabIndex={-1} className="mt-2 text-sm text-fg">
              {requestSent}
            </p>
          ) : null}
        </div>
        <form
          id="request-place-form"
          hidden={!requestOpen}
          aria-label="Request a new place"
          className="card pc-card mt-3 grid gap-3 p-4 sm:p-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (requestSendingRef.current) return;
            requestSendingRef.current = true;
            setRequestSending(true);
            setRequestError("");
            setRequestSent("");
            void settleSave(
              () => requestRoom({ kind, name, state: stateCode }),
              "That request was not sent.",
            ).then((result) => {
              requestSendingRef.current = false;
              setRequestSending(false);
              if (!result.ok) {
                setRequestError(result.error ?? "That request was not sent.");
                return;
              }
              setName("");
              setStateCode("");
              setRequestSent("Request sent. An admin will look at it.");
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
              ref={kindRef}
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
            aria-busy={requestSending || undefined}
            className={cn(btnSignal, "w-full justify-self-start sm:col-span-2 sm:w-auto")}
          >
            {requestSending ? "Sending…" : "Request room"}
          </button>
          {requestError ? (
            <p role="alert" className="text-sm text-danger sm:col-span-2">
              {requestError}
            </p>
          ) : null}
        </form>
      </div>

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
  onLeft,
}: {
  section: HomeSection;
  onOpen: (roomId: string) => void;
  onLeft: (roomName: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3">
      <h3 className="pc-h">{section.label}</h3>
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
              onLeft={onLeft}
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
  onLeft,
}: {
  roomId: string;
  name: string;
  audience?: "men" | "women";
  joined: boolean;
  onOpen: (roomId: string) => void;
  onLeft: (roomName: string) => void;
}) {
  const leaveRoom = useBoard((state) => state.leaveRoom);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);

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
            aria-busy={leaving || undefined}
            onClick={() => {
              if (leavingRef.current) return;
              leavingRef.current = true;
              setLeaving(true);
              setError("");
              void settleSave(() => leaveRoom(roomId), "That room was not left.").then((result) => {
                leavingRef.current = false;
                setLeaving(false);
                if (!result.ok) {
                  setError(result.error ?? "That room was not left.");
                  return;
                }
                onLeft(name);
              });
            }}
          >
            {leaving ? "Leaving…" : "Leave"}
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
  const [decided, setDecided] = useState("");
  const [deciding, setDeciding] = useState(false);
  const decidingRef = useRef(false);

  const decide = (decision: "approved" | "refused") => {
    if (decidingRef.current) return;
    decidingRef.current = true;
    setDeciding(true);
    setError("");
    setDecided("");
    void settleSave(
      () => decideRoom(request.id, { decision, note, stewardEmail, inviterEmail }),
      "That decision was not saved.",
    ).then((result) => {
      decidingRef.current = false;
      setDeciding(false);
      if (!result.ok) {
        setError(result.error ?? "That decision was not saved.");
        return;
      }
      setDecided(decision === "approved" ? "Approved." : "Refused.");
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
              aria-busy={deciding || undefined}
              onClick={() => decide("approved")}
            >
              Approve
            </button>
            <button
              type="button"
              className={`${btnGhost} min-h-[44px]`}
              aria-busy={deciding || undefined}
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
      {/* Approve and Refuse take their buttons away, so the outcome is said in the row. */}
      <div role="status" aria-live="polite">
        {decided ? <p className="mt-2 text-sm text-fg">{decided}</p> : null}
      </div>
    </article>
  );
}
