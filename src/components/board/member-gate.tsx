import type { ReactNode } from "react";
import { MEMBERS_ONLY_INVITE } from "@/lib/board/member-gate";

/** Shows the children to someone who may post, and the members-only line otherwise. */
export function MemberGate({ allowed, children }: { allowed: boolean; children?: ReactNode }) {
  if (allowed) return <>{children}</>;
  return <p className="text-sm text-muted">{MEMBERS_ONLY_INVITE}</p>;
}
