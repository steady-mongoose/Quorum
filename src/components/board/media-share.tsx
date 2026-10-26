import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-base";
import type { SharedMedia } from "@/lib/board/model";
import { IMAGE_BYTES, VIDEO_BYTES, VIDEO_MS, type MediaKind } from "@/lib/media/limits";
import { uploadRoomMedia } from "@/lib/media/upload";
import { getDmMediaCrypto } from "@/lib/media/e2e";
import { useServerSession } from "@/lib/server-session-state";
import { btnQuiet } from "@/components/quorum/bits";

type MediaStatus = {
  enabled: boolean;
  video: boolean;
  limits?: { imageBytes?: number; videoBytes?: number; videoMs?: number };
};

function useMediaStatus(): MediaStatus | "off" | "loading" {
  const server = useServerSession();
  const [status, setStatus] = useState<MediaStatus | "off" | "loading">("loading");
  const live = server.mode === "live" && Boolean(server.user);

  useEffect(() => {
    if (!live) {
      setStatus("off");
      return;
    }
    let cancelled = false;
    apiFetch("/api/media/status", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return "off" as const;
        const body = (await response.json()) as MediaStatus;
        return body?.enabled ? body : ("off" as const);
      })
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus("off");
      });
    return () => {
      cancelled = true;
    };
  }, [live]);

  return status;
}

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const ms = Math.round(video.duration * 1000);
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That video could not be read."));
    };
    video.src = url;
  });
}

/** One picture on a room post. Nothing here counts, likes, or reshares it. */
export function AttachPicture({
  roomId,
  postId,
  media,
  onAttached,
  onClear,
}: {
  roomId: string;
  postId: string;
  media: SharedMedia[];
  onAttached: (next: { postId: string; media: SharedMedia }) => void;
  onClear: () => void;
}) {
  const status = useMediaStatus();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const attached = media[0];

  if (status === "loading") return <p className="text-sm text-muted">Checking picture storage.</p>;
  if (status === "off") {
    return <p className="text-sm text-muted">Pictures are off until storage is set up.</p>;
  }

  const imageCap = status.limits?.imageBytes ?? IMAGE_BYTES;
  const videoCap = status.limits?.videoBytes ?? VIDEO_BYTES;
  const videoCapMs = status.limits?.videoMs ?? VIDEO_MS;
  const accept = status.video
    ? "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
    : "image/jpeg,image/png,image/webp,image/gif";

  const onFile = async (file: File | undefined) => {
    setError("");
    if (!file) return;
    const kind: MediaKind = file.type.startsWith("video/") ? "video" : "image";
    if (kind === "video" && !status.video) {
      setError("Video is off.");
      return;
    }
    if (file.size > (kind === "video" ? videoCap : imageCap)) {
      setError(kind === "video" ? "That video is over 32 MB." : "That picture is over 8 MB.");
      return;
    }
    setBusy(true);
    try {
      let durationMs: number | undefined;
      if (kind === "video") {
        durationMs = await readVideoDuration(file);
        if (!Number.isFinite(durationMs) || durationMs < 1) {
          setError("Add the length of the video.");
          return;
        }
        if (durationMs > videoCapMs) {
          setError("That video is longer than 60 seconds.");
          return;
        }
      }
      const nextPostId = postId || crypto.randomUUID();
      const uploaded = await uploadRoomMedia({
        bytes: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type,
        roomId,
        postId: nextPostId,
        durationMs,
      });
      if (!uploaded.ok) {
        setError(uploaded.error);
        return;
      }
      onAttached({ postId: nextPostId, media: { id: uploaded.id, kind: uploaded.kind } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The picture did not upload.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        One picture with the post. It is not scored and it is not reshared.
      </p>
      {attached ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-fg">
            {attached.kind === "video" ? "Video added." : "Picture added."}
          </span>
          <button type="button" className={btnQuiet} onClick={onClear} disabled={busy}>
            Remove
          </button>
        </div>
      ) : (
        <label className={btnQuiet}>
          {busy ? "Uploading." : status.video ? "Add a picture or a short video" : "Add a picture"}
          <input
            className="sr-only"
            type="file"
            accept={accept}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void onFile(file);
            }}
          />
        </label>
      )}
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Members load a short-lived link. There is no public file URL. */
export function SharedMediaFigure({ item }: { item: SharedMedia }) {
  const server = useServerSession();
  const [view, setView] = useState<{
    url: string;
    thumbUrl?: string;
    status: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (server.mode !== "live" || !server.user) return;
    let cancelled = false;
    apiFetch(`/api/media/${item.id}`, { credentials: "include" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          url?: string;
          thumbUrl?: string;
          status?: string;
          error?: string;
        } | null;
        if (!response.ok)
          return { url: "", status: "error", error: body?.error || "That file is not here." };
        return {
          url: body?.url ?? "",
          thumbUrl: body?.thumbUrl,
          status: body?.status ?? "processing",
          error: body?.error,
        };
      })
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch(() => {
        if (!cancelled) setView({ url: "", status: "error", error: "That file is not here." });
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, server.mode, server.user]);

  if (server.mode !== "live" || !server.user) return null;
  if (!view) return <p className="mt-2 text-sm text-muted">Loading the picture.</p>;
  if (view.status === "processing" || view.status === "pending") {
    return <p className="mt-2 text-sm text-muted">This picture is still being prepared.</p>;
  }
  if (view.status === "rejected" || view.status === "error" || !view.url) {
    return <p className="mt-2 text-sm text-muted">{view.error || "This picture was refused."}</p>;
  }
  if (item.kind === "video") {
    return (
      <figure className="mt-3 max-w-xl">
        <video
          className="w-full rounded-md border border-line bg-surface"
          controls
          playsInline
          preload="metadata"
          poster={view.thumbUrl}
          src={view.url}
        />
        <figcaption className="mt-1 text-xs text-muted">Video with this post.</figcaption>
      </figure>
    );
  }
  return (
    <figure className="mt-3 max-w-xl">
      <img
        className="max-h-96 w-full rounded-md border border-line object-contain"
        src={view.thumbUrl || view.url}
        alt="Picture with this post"
      />
      {view.thumbUrl ? (
        <figcaption className="mt-1 text-xs text-muted">
          <a className="text-signal underline" href={view.url} target="_blank" rel="noreferrer">
            Full size
          </a>
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Shown on the messages page. The messaging change turns the real control on. */
export function MessagePictureNote() {
  const ready = getDmMediaCrypto() !== null;
  return (
    <p className="max-w-prose text-sm text-muted">
      {ready
        ? "A picture in a message is encrypted on this device before it is sent."
        : "A picture in a message is encrypted on this device before it is sent. That step is not in place yet."}
    </p>
  );
}
