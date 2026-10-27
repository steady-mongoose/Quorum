import type { HardRuleValue } from "../board/text.ts";

/** Copy for "Report this message". DMs are encrypted, so sharing the text is the reporter's choice. */
export const DM_REPORT_BUTTON = "Report this message";
export const DM_REPORT_HEADING = "Report this message";
export const DM_REPORT_SHARE_LABEL = "Share the text of this message with admins";
export const DM_REPORT_SHARE_HINT =
  "Messages are encrypted, so admins cannot read them unless you share the text. They see it as you shared it.";
export const DM_REPORT_CSAM_HINT =
  "For child sexual abuse material, do not share the text. Admins keep the message from being deleted while they act.";
export const DM_REPORT_SENT = "Reported. An admin will review it.";
export const DM_REPORT_REASON_ERROR = "Choose a reason.";
export const DM_REPORT_TEXT_MAX = 4000;
export const DM_REPORT_NOTE_MAX = 500;

export const DM_REPORT_REASONS: readonly { value: HardRuleValue; label: string }[] = [
  { value: "csam", label: "Child sexual abuse material" },
  { value: "porn", label: "Pornography" },
  { value: "threat", label: "A threat or a call for violence" },
  { value: "doxxing", label: "Someone's private details" },
  { value: "blasphemy", label: "Blasphemy" },
];
