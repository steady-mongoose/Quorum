import { apiFetch } from "./api-base.ts";

export type VisibilityChoice = "members" | "shared" | "private";

export type ProfileOptions = {
  counties: { id: string; name: string }[];
  towns: { id: string; name: string; county: string }[];
  elsewhere: { id: string; name: string };
  interests: { id: string; label: string }[];
  churches: string[];
  visibility: VisibilityChoice[];
  minAge: number;
  adminsOnly: string;
  anonymous: string;
};

export type ProfileLocation = {
  town: string;
  county: string;
  townName: string;
  countyName: string;
};

export type MemberProfileBody = {
  userId: string;
  self: boolean;
  displayName: string;
  vouchedName?: string;
  bio?: string;
  gender?: "man" | "woman" | null;
  age?: number | null;
  birthdateSet?: boolean;
  location?: ProfileLocation | null;
  church?: string;
  interests?: { id: string; label: string }[];
  links?: { url: string; label: string }[];
  photo?: { id: string; status: string } | null;
  onboarded?: boolean;
  visibility?: Record<string, string>;
  missing?: string[];
};

export type OwnProfileResult =
  | { ok: true; profile: MemberProfileBody; options: ProfileOptions }
  | { ok: false; status: number; error: string };

function errorMessage(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string" &&
    body.error
  ) {
    return body.error;
  }
  return fallback;
}

async function readBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** The signed-in member's profile, including the lists the form needs. */
export async function loadOwnProfile(): Promise<OwnProfileResult> {
  const response = await apiFetch("/api/profile", { credentials: "include" });
  const body = (await readBody(response)) as {
    error?: unknown;
    profile?: MemberProfileBody;
    options?: ProfileOptions;
  } | null;
  if (!response.ok || !body?.profile || !body.options) {
    return {
      ok: false,
      status: response.status,
      error: errorMessage(body, "The profile could not be loaded."),
    };
  }
  return { ok: true, profile: body.profile, options: body.options };
}

/** Another member, through the same visibility rules as the server. */
export async function loadMemberProfile(
  userId: string,
): Promise<
  { ok: true; profile: MemberProfileBody } | { ok: false; status: number; error: string }
> {
  const response = await apiFetch(`/api/profile/${encodeURIComponent(userId)}`, {
    credentials: "include",
  });
  const body = (await readBody(response)) as {
    error?: unknown;
    profile?: MemberProfileBody;
  } | null;
  if (!response.ok || !body?.profile) {
    return {
      ok: false,
      status: response.status,
      error: errorMessage(body, "That profile could not be loaded."),
    };
  }
  return { ok: true, profile: body.profile };
}

export async function saveProfile(
  path: "/api/profile" | "/api/profile/onboard",
  method: "PATCH" | "POST",
  payload: Record<string, unknown>,
): Promise<{ ok: true; profile: MemberProfileBody } | { ok: false; error: string }> {
  const response = await apiFetch(path, {
    method,
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await readBody(response)) as {
    error?: unknown;
    profile?: MemberProfileBody;
  } | null;
  if (!response.ok || !body?.profile) {
    return { ok: false, error: errorMessage(body, "That profile was not saved.") };
  }
  return { ok: true, profile: body.profile };
}

export async function attachProfilePhoto(
  mediaId: string,
): Promise<{ ok: true; profile: MemberProfileBody } | { ok: false; error: string }> {
  const response = await apiFetch("/api/profile/photo", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mediaId }),
  });
  const body = (await readBody(response)) as {
    error?: unknown;
    profile?: MemberProfileBody;
  } | null;
  if (!response.ok || !body?.profile) {
    return { ok: false, error: errorMessage(body, "That picture was not added.") };
  }
  return { ok: true, profile: body.profile };
}
