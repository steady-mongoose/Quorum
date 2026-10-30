import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { CAMERA_DENIED, MIC_DENIED, liveLine, openMedia } from "@/lib/calls/media";
import { Mic, MicOff, PhoneCall, PhoneOff, Video, VideoOff } from "lucide-react";
import { apiFetch } from "@/lib/api-base";
import { userFacingError } from "@/lib/user-facing-error";
import { callsAreAvailable, parseCallJoin } from "@/lib/calls/status";
import { RoomCallSession, type RemotePeer } from "@/lib/calls/session";
import { emitRingOutcome, onRingOutcome } from "@/lib/calls/rings";
import { useServerSession } from "@/lib/server-session-state";
import { btnGhost, btnSignal, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { focusWithRing } from "@/lib/board/focus-ring";

/**
 * The button stays out of the page until the API says calls are on.
 * Josh sets CALLS=on on the box. A rebuild of the site is not required.
 */
export const ROOM_CALL_JOIN_ID = "room-call-join";

/** True once the API says calls are on and not recorded. */
export function useCallsEnabled(): { enabled: boolean; selfId: string | null } {
  const server = useServerSession();
  const live = server.mode === "live" && Boolean(server.user);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!live) {
      setEnabled(false);
      return;
    }
    let cancelled = false;
    apiFetch("/api/calls/status", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return false;
        return callsAreAvailable(await response.json());
      })
      .then((on) => {
        if (!cancelled) setEnabled(on);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [live]);

  return { enabled: live && enabled, selfId: server.user?.id ?? null };
}

/**
 * The button stays out of the page until the API says calls are on.
 * Josh sets CALLS=on on the box. A rebuild of the site is not required.
 */
export function RoomCall({ roomId }: { roomId: string }) {
  const { enabled, selfId } = useCallsEnabled();
  if (!enabled || !selfId) return null;
  return (
    <CallPanel
      key={roomId}
      callKey={roomId}
      basePath={`/api/calls/rooms/${roomId}`}
      selfId={selfId}
      label="Room call"
      note="This call is not recorded. Only this room's members and stewards can join."
      joinLabel="Join the call"
      joinId={ROOM_CALL_JOIN_ID}
      extra={<RingMembers roomId={roomId} />}
    />
  );
}

/** Who else is in the live call, and the panel, for the picker below it. */
const InCall = createContext<{
  peerIds: string[];
  panel: RefObject<HTMLElement | null>;
  /** This panel has already been told "you can ring here". */
  canRing: RefObject<boolean>;
}>({
  peerIds: [],
  panel: { current: null },
  canRing: { current: false },
});

/** Host, steward, or admin only. The list stays hidden for everyone else. */
function RingMembers({ roomId }: { roomId: string }) {
  const { peerIds, panel, canRing } = useContext(InCall);
  const [members, setMembers] = useState<{ id: string; name: string }[] | null>(null);
  const [choice, setChoice] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  /** The list didn't load: say so and offer Try again, rather than vanish. */
  const [failed, setFailed] = useState(false);
  const [loadLine, setLoadLine] = useState("");
  const [attempt, setAttempt] = useState(0);
  const retried = useRef(false);
  /** Quiet retries used on a fault with no sign this person can ring (at most one). */
  const quietTries = useRef(0);
  /** Where focus goes once a Try again has worked and the button is gone. */
  const focusNext = useRef(false);
  /** The member last rung, so their "Calling …" line clears when they join. */
  const calling = useRef<{ id: string; name: string } | null>(null);
  const fieldId = useId();
  const fieldRef = useRef<HTMLSelectElement | null>(null);
  /** The picker, and whether focus was last inside it (it may already be gone when we check). */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const focusInside = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let quietRetry: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      setMembers(null);
      setFailed(true);
      setLoadLine(PICKER_LOAD_FAILED);
    };
    // A Try again that worked: hand focus on, and stop counting it as a retry.
    const settled = () => {
      if (!retried.current) return;
      retried.current = false;
      focusNext.current = true;
    };
    // A fault with no sign this person can ring: stay hidden (a plain member has no picker
    // to miss), and try once more quietly in case it was a blip.
    const unproven = () => {
      setFailed(false);
      setLoadLine("");
      setMembers(null);
      if (quietTries.current >= 1) return;
      quietTries.current += 1;
      quietRetry = setTimeout(() => setAttempt((n) => n + 1), QUIET_RETRY_MS);
    };
    // Say it didn't load only when there is evidence they can ring: the server's own
    // picker 503 (sent only after the permission check passed), or an earlier "can ring"
    // in this panel. A Try again that fails keeps the line it was pressed from.
    const faulted = (status: number, body: unknown) => {
      const row = body as { checked?: unknown; error?: unknown } | null;
      const pickerFault =
        status === 503 && (row?.checked === true || row?.error === PICKER_LOAD_FAILED);
      if (retried.current || pickerFault || canRing.current) fail();
      else unproven();
    };
    apiFetch(`/api/calls/rooms/${roomId}/ring`, { credentials: "include", cache: "no-store" })
      .then(async (response) => ({
        status: response.status,
        body: (await response.json().catch(() => null)) as unknown,
      }))
      .then(({ status, body }) => {
        if (cancelled) return;
        const row = body as { canRing?: unknown; members?: unknown } | null;
        if (status === 200 && row?.canRing === true && Array.isArray(row.members)) {
          canRing.current = true;
          setFailed(false);
          setLoadLine("");
          settled();
          setMembers(
            row.members.filter(
              (m): m is { id: string; name: string } =>
                Boolean(m) && typeof m.id === "string" && typeof m.name === "string",
            ),
          );
          return;
        }
        // Not someone who can ring (a plain 200 with canRing false, or a 4xx
        // on the first load): no picker, and nothing to say.
        // A plain "can't ring" now (host rights gone, say) also ends any earlier evidence.
        if (status === 200 && row?.canRing === false) canRing.current = false;
        if (status === 200 || (status >= 400 && status < 500 && !retried.current)) {
          setFailed(false);
          setLoadLine("");
          settled();
          setMembers(null);
          return;
        }
        faulted(status, body);
      })
      .catch(() => {
        if (!cancelled) faulted(0, null);
      });
    return () => {
      cancelled = true;
      clearTimeout(quietRetry);
    };
  }, [roomId, attempt, canRing]);

  // After a Try again that worked, focus the member list; if there is no list
  // (nobody left to call), the call panel, so focus never drops to the page.
  const handFocusOn = () => {
    if (!focusNext.current || failed) return;
    focusNext.current = false;
    const field = fieldRef.current;
    if (field) {
      focusWithRing(field);
      return;
    }
    const box = panel.current;
    if (!box) return;
    if (!box.hasAttribute("tabindex")) box.setAttribute("tabindex", "-1");
    focusWithRing(box);
  };
  useEffect(handFocusOn);

  useEffect(
    () =>
      // The call's own line now says "Ann isn't available right now." or "Ann didn't answer."
      onRingOutcome((outcome) =>
        setStatus((line) => (line.startsWith(`Calling ${outcome.name}.`) ? "" : line)),
      ),
    [],
  );

  // The member rung has joined: their "Calling …" line goes, and so do they from the list.
  const peerKey = peerIds.join(",");
  useEffect(() => {
    // Everyone on the list is now in the call, so the picker is gone: if focus was in it,
    // move it to the call panel rather than let it drop to the page.
    const left = (members ?? []).filter((m) => !peerIds.includes(m.id));
    const active = document.activeElement;
    const dropped = !active || active === document.body;
    if (
      members &&
      left.length === 0 &&
      (wrapRef.current?.contains(active) || (focusInside.current && dropped))
    ) {
      focusInside.current = false;
      focusNext.current = true;
      handFocusOn();
    }
    const rung = calling.current;
    if (!rung || !peerIds.includes(rung.id)) return;
    calling.current = null;
    // Say so: focus may still be on Call, whose name changes without being read out.
    setStatus((line) =>
      line.startsWith(`Calling ${rung.name}.`) ? `${rung.name} joined the call.` : line,
    );
    setChoice((id) => (id === rung.id ? "" : id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerKey]);

  if (failed) {
    return (
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <p className={cn("text-sm text-fg", WRAP)} role="status">
          {loadLine}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(btnGhost, "min-h-[44px]")}
            onClick={() => {
              retried.current = true;
              // Empty the line first, so the same sentence is read again if it fails again.
              setLoadLine("");
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Someone already in the call is not offered again.
  const offered = members ? members.filter((m) => !peerIds.includes(m.id)) : [];
  if (offered.length === 0) {
    // The "Calling …" line still shows until it clears.
    return status ? (
      <p className={cn("border-t border-line pt-3 text-sm text-muted", WRAP)} role="status">
        {status}
      </p>
    ) : null;
  }
  const chosen = offered.find((m) => m.id === choice);

  const ring = async () => {
    if (!chosen) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await apiFetch(`/api/calls/rooms/${roomId}/ring`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: chosen.id }),
      });
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      calling.current = response.ok ? chosen : null;
      setStatus(
        response.ok
          ? `Calling ${chosen.name}. It rings for up to a minute.`
          : userFacingError(
              typeof body?.error === "string" ? body.error : "",
              "The call didn't go through.",
            ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={wrapRef}
      className="flex flex-col gap-2 border-t border-line pt-3"
      onFocus={() => {
        focusInside.current = true;
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !event.currentTarget.contains(next)) focusInside.current = false;
      }}
    >
      <label htmlFor={fieldId} className="text-sm font-semibold text-fg">
        Call a member to this room
      </label>
      <div className="flex flex-wrap gap-2">
        <select
          ref={fieldRef}
          id={fieldId}
          className={cn(fieldClass, "min-h-[44px] max-w-xs")}
          value={chosen ? choice : ""}
          onChange={(event) => setChoice(event.target.value)}
        >
          <option value="">Choose a member</option>
          {offered.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={cn(btnGhost, "min-h-[44px] aria-disabled:opacity-70")}
          // aria-disabled, not disabled: a natively disabled button drops focus to the page.
          aria-disabled={!chosen || busy || undefined}
          onClick={() => {
            if (!chosen || busy) return;
            void ring();
          }}
        >
          <PhoneCall className="size-4" aria-hidden="true" />
          {chosen ? `Call ${chosen.name}` : "Call"}
        </button>
      </div>
      <p className="text-sm text-muted" role="status">
        {status}
      </p>
    </div>
  );
}

/** Same words as the server's PICKER_FAILED (server/calls/routes.ts). */
const PICKER_LOAD_FAILED = "We couldn't load the members you can call.";
/** How long the one quiet retry waits after an unexplained fault. */
const QUIET_RETRY_MS = 3000;

function bindStream(node: HTMLVideoElement | null, stream: MediaStream | null) {
  if (!node || !stream || node.srcObject === stream) return;
  node.srcObject = stream;
}

export type CallPanelProps = {
  callKey: string;
  basePath: string;
  selfId: string;
  label: string;
  note: string;
  joinLabel: string;
  extra?: ReactNode;
  /** Shown before joining, e.g. Close on the DM panel. */
  onClose?: () => void;
  /** DOM id for the Join button, so a ring can send focus to it. */
  joinId?: string;
  /** Join as soon as the panel opens (Join on an incoming-call alert). */
  autoJoin?: boolean;
  /** DM calls: starting the call rings this person. */
  calleeName?: string;
  /** The call ended without this person choosing Leave (they hear why). */
  onEnded?: (message: string) => void;
  /** This person chose Leave call. */
  onLeave?: () => void;
};

/** Long names wrap instead of pushing the card wider than a 390px screen. */
export const WRAP = "min-w-0 [overflow-wrap:anywhere]";

export const YOU_LEFT = "You left the call.";

export function CallPanel({
  callKey,
  basePath,
  selfId,
  label,
  note,
  joinLabel,
  extra,
  onClose,
  joinId,
  autoJoin,
  calleeName,
  onEnded,
  onLeave,
}: CallPanelProps) {
  const [phase, setPhase] = useState<"idle" | "joining" | "live">("idle");
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [notice, setNotice] = useState("");
  /** How the last call ended, shown once the panel is back to Join. */
  const [ended, setEnded] = useState("");
  /** "Calling Ann." or "Ben left the call." while the call goes on. */
  const [callNote, setCallNote] = useState("");
  const autoJoined = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const soundOnlyId = useId();
  const muteRef = useRef<HTMLButtonElement | null>(null);
  const joinRef = useRef<HTMLButtonElement | null>(null);
  const focusJoin = useRef(false);
  const [remotes, setRemotes] = useState<RemotePeer[]>([]);
  const peerKey = remotes.map((peer) => peer.id).join(",");
  const canRingRef = useRef(false);
  const inCall = useMemo(
    () => ({ peerIds: peerKey ? peerKey.split(",") : [], panel: panelRef, canRing: canRingRef }),
    [peerKey],
  );
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const sessionRef = useRef<RoomCallSession | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const alive = useRef(true);

  const remember = (stream: MediaStream | null) => {
    streamRef.current = stream;
    setLocalStream(stream);
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sessionRef.current?.close();
      sessionRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [callKey]);

  useEffect(() => {
    if (phase === "live") muteRef.current?.focus();
    if (phase === "idle" && focusJoin.current) {
      focusJoin.current = false;
      joinRef.current?.focus();
    }
  }, [phase]);

  const leave = () => {
    focusJoin.current = true;
    sessionRef.current?.close();
    sessionRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    remember(null);
    setRemotes([]);
    setPhase("idle");
    setMicOn(true);
    setCameraOn(true);
    setCameraDenied(false);
    setNotice("");
    setCallNote("");
    setEnded(YOU_LEFT);
    onLeave?.();
  };

  const join = async () => {
    setError("");
    setNotice("");
    setEnded("");
    setCallNote("");
    setPhase("joining");
    const opened = await openMedia((c) => navigator.mediaDevices.getUserMedia(c));
    if (!opened) {
      setPhase("idle");
      setError(MIC_DENIED);
      return;
    }
    const stream = opened.stream;
    setCameraDenied(opened.cameraDenied);
    setCameraOn(!opened.cameraDenied);
    if (opened.cameraDenied) setNotice(CAMERA_DENIED);
    remember(stream);
    if (!alive.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const response = await apiFetch(`${basePath}/join`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: calleeName ? JSON.stringify({ ring: true }) : "{}",
    });
    const body = (await response.json().catch(() => null)) as unknown;
    if (!alive.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const joined = response.ok ? parseCallJoin(body) : null;
    if (!joined || joined.selfId !== selfId) {
      stream.getTracks().forEach((track) => track.stop());
      remember(null);
      setPhase("idle");
      const fallback = "The call did not start.";
      const message =
        body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : fallback;
      setError(userFacingError(message, fallback));
      return;
    }
    const session = new RoomCallSession({
      roomId: callKey,
      basePath,
      selfId,
      cursor: joined.cursor,
      iceServers: joined.iceServers,
      localStream: stream,
      onPeers: (peers) => {
        setRemotes(peers);
        if (peers.length > 0) setCallNote((line) => (line.startsWith("Calling ") ? "" : line));
      },
      onNote: (message) => setCallNote(message),
      onOutcome: (outcome) => emitRingOutcome(outcome),
      onEnded: (message) => {
        focusJoin.current = true;
        stream.getTracks().forEach((track) => track.stop());
        remember(null);
        sessionRef.current = null;
        setRemotes([]);
        setPhase("idle");
        setMicOn(true);
        setCameraOn(true);
        setCameraDenied(false);
        setNotice("");
        setCallNote("");
        setEnded(message);
        onEnded?.(message);
      },
      onStopped: (message) => {
        focusJoin.current = true;
        stream.getTracks().forEach((track) => track.stop());
        remember(null);
        sessionRef.current = null;
        setRemotes([]);
        setPhase("idle");
        setError(message);
      },
    });
    sessionRef.current = session;
    try {
      await session.syncPeers(joined.peers);
      if (!alive.current) {
        session.close();
        return;
      }
      session.start();
      setPhase("live");
      if (calleeName && joined.ringing && joined.peers.length === 0) {
        setCallNote(`Calling ${calleeName}. It rings for up to a minute.`);
      } else if (calleeName && joined.ringError) {
        // The call is open, but the ring was not sent. Say so plainly.
        setCallNote(`${calleeName} wasn't rung. ${joined.ringError}`);
      }
    } catch {
      session.close();
      sessionRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      remember(null);
      setPhase("idle");
      setError("The call did not start.");
    }
  };

  useEffect(() => {
    if (!autoJoin || autoJoined.current) return;
    autoJoined.current = true;
    // The alert that opened this panel is gone; hold focus here (not <body>)
    // until Mute takes it once the call is live.
    panelRef.current?.focus({ preventScroll: true });
    void join();
    // Once, when the panel opens from an incoming-call alert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoin]);

  const toggle = (kind: "audio" | "video") => {
    const tracks = localStream?.getTracks().filter((track) => track.kind === kind) ?? [];
    if (kind === "video" && cameraDenied) return;
    const next = kind === "audio" ? !micOn : !cameraOn;
    for (const track of tracks) track.enabled = next;
    if (kind === "audio") setMicOn(next);
    else setCameraOn(next);
  };

  return (
    <section
      ref={panelRef}
      tabIndex={autoJoin ? -1 : undefined}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4 focus-target"
      aria-label={label}
    >
      <p className={cn("text-sm text-muted", WRAP)}>{note}</p>
      <p className={cn("text-sm text-muted", WRAP)} role="status" aria-live="polite">
        {phase === "live"
          ? liveLine(micOn, cameraOn)
          : phase === "joining"
            ? "Joining the call."
            : ended}
      </p>
      {phase === "live" && callNote ? (
        <p className={cn("text-sm text-fg", WRAP)} role="status">
          {callNote}
        </p>
      ) : null}
      {notice ? (
        <p
          id={notice === CAMERA_DENIED ? soundOnlyId : undefined}
          className={cn("text-sm text-fg", WRAP)}
        >
          {notice}
        </p>
      ) : null}
      {cameraDenied && notice !== CAMERA_DENIED ? (
        <span id={soundOnlyId} className="sr-only">
          {CAMERA_DENIED}
        </span>
      ) : null}
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {phase === "live" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {cameraOn ? (
            <figure className="flex flex-col gap-2">
              <video
                ref={(node) => bindStream(node, localStream)}
                autoPlay
                playsInline
                muted
                className="aspect-video w-full -scale-x-100 rounded-md bg-fg/10 object-cover landscape:max-h-[50svh]"
              />
              <figcaption className="text-sm text-muted">You</figcaption>
            </figure>
          ) : null}
          {remotes.map((peer) => (
            <figure key={peer.id} className="flex flex-col gap-2">
              <video
                ref={(node) => bindStream(node, peer.stream as MediaStream | null)}
                autoPlay
                playsInline
                className="aspect-video w-full rounded-md bg-fg/10 object-cover landscape:max-h-[50svh]"
                aria-label={peer.name}
              />
              <figcaption className="text-sm text-muted">
                {peer.name}
                {peer.connectionState === "connected" ? "" : " · connecting"}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {phase === "live" ? (
          <>
            <button
              ref={muteRef}
              type="button"
              className={cn(btnGhost, "min-h-[44px]")}
              aria-pressed={!micOn}
              onClick={() => toggle("audio")}
            >
              {micOn ? (
                <Mic className="size-4" aria-hidden="true" />
              ) : (
                <MicOff className="size-4" aria-hidden="true" />
              )}
              Mute
            </button>
            <button
              type="button"
              className={cn(btnGhost, "min-h-[44px]")}
              aria-pressed={!cameraOn}
              aria-disabled={cameraDenied || undefined}
              aria-describedby={cameraDenied ? soundOnlyId : undefined}
              onClick={() => toggle("video")}
            >
              {cameraOn ? (
                <Video className="size-4" aria-hidden="true" />
              ) : (
                <VideoOff className="size-4" aria-hidden="true" />
              )}
              Camera off
            </button>
            <button type="button" className={cn(btnSignal, "min-h-[44px]")} onClick={leave}>
              <PhoneOff className="size-4" aria-hidden="true" />
              Leave call
            </button>
          </>
        ) : (
          <>
            <button
              ref={joinRef}
              id={joinId}
              type="button"
              className={cn(btnSignal, "min-h-[44px]")}
              onClick={() => void join()}
              disabled={phase === "joining"}
            >
              <Video className="size-4" aria-hidden="true" />
              {phase === "joining" ? "Joining" : joinLabel}
            </button>
            {onClose && phase === "idle" ? (
              <button type="button" className={cn(btnGhost, "min-h-[44px]")} onClick={onClose}>
                Close
              </button>
            ) : null}
          </>
        )}
      </div>
      {phase === "live" ? <InCall.Provider value={inCall}>{extra}</InCall.Provider> : null}
    </section>
  );
}
