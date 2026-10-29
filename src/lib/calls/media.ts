import { APP_NAME } from "../board/model.ts";

export const MIC_DENIED =
  `${APP_NAME} can't use your microphone. Allow it in your browser's site settings, then choose Join the call again.`;
export const CAMERA_UNAVAILABLE_LABEL = "Camera unavailable";
export const CAMERA_DENIED = "Your camera isn't available, so you joined with sound only.";
export const RECORDING_LEFT =
  `This call tried to start recording, so you left it. ${APP_NAME} calls are never recorded.`;
export const MALFORMED_LEFT =
  "The call stopped because of a problem on our end. Try joining again.";

/** The polite live line under the call. */
export function liveLine(micOn: boolean, cameraOn: boolean): string {
  if (micOn && cameraOn) return "Your camera and microphone are on.";
  if (!micOn && cameraOn) return "You're muted. Your camera is on.";
  if (micOn && !cameraOn) return "Your camera is off. Your microphone is on.";
  return "You're muted and your camera is off.";
}

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

/**
 * Camera and mic, else mic only. A failed mic is the only hard stop.
 * cameraDenied tells the panel to disable the camera button.
 */
export async function openMedia(
  getUserMedia: GetUserMedia,
): Promise<{ stream: MediaStream; cameraDenied: boolean } | null> {
  const audio = { echoCancellation: true, noiseSuppression: true };
  try {
    const stream = await getUserMedia({
      audio,
      video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 } },
    });
    return { stream, cameraDenied: stream.getVideoTracks().length === 0 };
  } catch {
    try {
      return { stream: await getUserMedia({ audio, video: false }), cameraDenied: true };
    } catch {
      return null;
    }
  }
}
