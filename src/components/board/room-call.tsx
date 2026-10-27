import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
      note="This call is not recorded. Only people who have stood in this room can join."
      joinLabel="Join the call"
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

async function openMicAndCamera(): Promise<MediaStream> {
  const audio = { echoCancellation: true, noiseSuppression: true };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio,
      video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 } },
    });
  } catch {
    return navigator.mediaDevices.getUserMedia({ audio, video: false });
  }
}

export type CallPanelProps = {
  callKey: string;
  basePath: string;
  selfId: string;
  label: string;
  note: string;
  joinLabel: string;
  extra?: ReactNode;
};

export function CallPanel({
  callKey,
  basePath,
  selfId,
  label,
  note,
  joinLabel,
  extra,
}: CallPanelProps) {
  const [phase, setPhase] = useState<"idle" | "joining" | "live">("idle");
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
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

  const leave = () => {
    sessionRef.current?.close();
    sessionRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    remember(null);
    setRemotes([]);
    setPhase("idle");
    setMicOn(true);
    setCameraOn(true);
  };

  const join = async () => {
    setError("");
    setPhase("joining");
    let stream: MediaStream;
    try {
      stream = await openMicAndCamera();
    } catch {
      setPhase("idle");
      setError("The browser did not get permission to use the microphone.");
      return;
    }
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
      body: "{}",
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
      onPeers: (peers) => setRemotes(peers),
      onStopped: (message) => {
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
    } catch {
      session.close();
      sessionRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      remember(null);
      setPhase("idle");
      setError("The call did not start.");
    }
  };

  const toggle = (kind: "audio" | "video") => {
    const tracks = localStream?.getTracks().filter((track) => track.kind === kind) ?? [];
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
      <p className="sr-only" role="status">
        {phase === "live" ? "You're in the call." : phase === "joining" ? "Joining the call." : ""}
      </p>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {phase === "live" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <figure className="flex flex-col gap-2">
            <video
              ref={(node) => bindStream(node, localStream)}
              autoPlay
              playsInline
              muted
              className="aspect-video w-full rounded-md bg-fg/10 object-cover"
            />
            <figcaption className="text-sm text-muted">You</figcaption>
          </figure>
          {remotes.map((peer) => (
            <figure key={peer.id} className="flex flex-col gap-2">
              <video
                ref={(node) => bindStream(node, peer.stream as MediaStream | null)}
                autoPlay
                playsInline
                className="aspect-video w-full rounded-md bg-fg/10 object-cover"
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
              {micOn ? "Mute" : "Unmute"}
            </button>
            <button
              type="button"
              className={cn(btnGhost, "min-h-[44px]")}
              aria-pressed={!cameraOn}
              onClick={() => toggle("video")}
            >
              {cameraOn ? (
                <Video className="size-4" aria-hidden="true" />
              ) : (
                <VideoOff className="size-4" aria-hidden="true" />
              )}
              {cameraOn ? "Camera off" : "Camera on"}
            </button>
            <button type="button" className={cn(btnSignal, "min-h-[44px]")} onClick={leave}>
              <PhoneOff className="size-4" aria-hidden="true" />
              Leave call
            </button>
          </>
        ) : (
          <button
            type="button"
            className={cn(btnSignal, "min-h-[44px]")}
            onClick={() => void join()}
            disabled={phase === "joining"}
          >
            <Video className="size-4" aria-hidden="true" />
            {phase === "joining" ? "Joining" : joinLabel}
          </button>
        )}
      </div>
      {phase === "live" ? extra : null}
    </section>
  );
}
