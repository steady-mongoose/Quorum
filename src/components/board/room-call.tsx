import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  CAMERA_DENIED,
  MIC_DENIED,
  liveLine,
  openMedia,
} from "@/lib/calls/media";
import { Mic, MicOff, PhoneCall, PhoneOff, Video, VideoOff } from "lucide-react";
import { apiFetch } from "@/lib/api-base";
import { userFacingError } from "@/lib/user-facing-error";
import { callsAreAvailable, parseCallJoin } from "@/lib/calls/status";
import { RoomCallSession, type RemotePeer } from "@/lib/calls/session";
import { useServerSession } from "@/lib/server-session-state";
import { btnGhost, btnSignal, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";

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

/** Host, steward, or admin only. The list stays hidden for everyone else. */
function RingMembers({ roomId }: { roomId: string }) {
  const [members, setMembers] = useState<{ id: string; name: string }[] | null>(null);
  const [choice, setChoice] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const fieldId = useId();

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/calls/rooms/${roomId}/ring`, { credentials: "include", cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as unknown) : null))
      .then((body) => {
        if (cancelled) return;
        const row = body as { canRing?: unknown; members?: unknown } | null;
        if (!row || row.canRing !== true || !Array.isArray(row.members)) {
          setMembers(null);
          return;
        }
        setMembers(
          row.members.filter(
            (m): m is { id: string; name: string } =>
              Boolean(m) && typeof m.id === "string" && typeof m.name === "string",
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setMembers(null);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  if (!members || members.length === 0) return null;
  const chosen = members.find((m) => m.id === choice);

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
      setStatus(
        response.ok
          ? `Calling ${chosen.name}. They'll see it for one minute.`
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
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <label htmlFor={fieldId} className="text-sm font-semibold text-fg">
        Call a member to this room
      </label>
      <div className="flex flex-wrap gap-2">
        <select
          id={fieldId}
          className={cn(fieldClass, "min-h-[44px] max-w-xs")}
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          <option value="">Choose a member</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={cn(btnGhost, "min-h-[44px]")}
          onClick={() => void ring()}
          disabled={!chosen || busy}
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
  const soundOnlyId = useId();
  const muteRef = useRef<HTMLButtonElement | null>(null);
  const joinRef = useRef<HTMLButtonElement | null>(null);
  const focusJoin = useRef(false);
  const [remotes, setRemotes] = useState<RemotePeer[]>([]);
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
        setCallNote(`Calling ${calleeName}. They'll see it for one minute.`);
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
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      aria-label={label}
    >
      <p className="text-sm text-muted">{note}</p>
      <p className="text-sm text-muted" role="status" aria-live="polite">
        {phase === "live"
          ? liveLine(micOn, cameraOn)
          : phase === "joining"
            ? "Joining the call."
            : ended}
      </p>
      {phase === "live" && callNote ? (
        <p className="text-sm text-fg" role="status">
          {callNote}
        </p>
      ) : null}
      {notice ? (
        <p id={notice === CAMERA_DENIED ? soundOnlyId : undefined} className="text-sm text-fg">
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
                className="aspect-video w-full -scale-x-100 rounded-md bg-fg/10 object-cover landscape:max-h-[50vh]"
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
                className="aspect-video w-full rounded-md bg-fg/10 object-cover landscape:max-h-[50vh]"
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
      {phase === "live" ? extra : null}
    </section>
  );
}
