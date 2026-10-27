import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/api-base";
import { uploadProfilePhoto } from "@/lib/media/upload";
import {
  askCorrection,
  attachProfilePhoto,
  decideCorrection,
  listCorrections,
  removeOwnPhoto,
  type CorrectionRow,
  loadMemberProfile,
  loadOwnProfile,
  saveProfile,
  type MemberProfileBody,
  type ProfileOptions,
  type VisibilityChoice,
} from "@/lib/profile-client";
import { linkText } from "@/lib/profile-links";

const VISIBILITY: { id: VisibilityChoice; label: string }[] = [
  { id: "members", label: "All members" },
  { id: "shared", label: "People in a room with you" },
  { id: "private", label: "Only you" },
];

const FIELDS: { id: string; label: string }[] = [
  { id: "photo", label: "Photo" },
  { id: "bio", label: "Bio" },
  { id: "gender", label: "Gender" },
  { id: "age", label: "Age" },
  { id: "location", label: "Town" },
  { id: "church", label: "Church" },
  { id: "interests", label: "Interests" },
  { id: "links", label: "Links" },
];

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a45c]";
const choiceFocus =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#c9a45c]";
const inputClass = cn(fieldClass, "min-h-[44px]", FOCUS);


function genderLabel(gender: "man" | "woman" | null | undefined): string {
  if (gender === "man") return "Man";
  if (gender === "woman") return "Woman";
  return "Not set";
}

function latestBirthdate(minAge: number): string {
  const now = new Date();
  const year = now.getUTCFullYear() - minAge;
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function useProfileGate(active: boolean): {
  state: "off" | "checking" | "needed" | "ready";
  error: string;
  markReady: () => void;
} {
  const [state, setState] = useState<"off" | "checking" | "needed" | "ready">("off");
  const [error, setError] = useState("");
  const markReady = useCallback(() => {
    setError("");
    setState("ready");
  }, []);

  useEffect(() => {
    if (!active) {
      setState("off");
      setError("");
      return;
    }
    let cancel = false;
    setState("checking");
    void loadOwnProfile().then((result) => {
      if (cancel) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          setState("ready");
          return;
        }
        setError(result.error);
        setState("needed");
        return;
      }
      setError("");
      setState(result.profile.onboarded ? "ready" : "needed");
    });
    return () => {
      cancel = true;
    };
  }, [active]);

  return { state, error, markReady };
}

function Notice({ children }: { children: string }) {
  if (!children) return null;
  return (
    <p className="text-base text-danger" role="alert">
      {children}
    </p>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-base text-fg">
      <span className="font-semibold">{label}</span>
      {hint ? <span className="text-muted">{hint}</span> : null}
      {children}
    </label>
  );
}

export function OnboardingWizard({
  notice,
  onFinished,
}: {
  notice: string;
  onFinished: () => void;
}) {
  const [profile, setProfile] = useState<MemberProfileBody | null>(null);
  const [options, setOptions] = useState<ProfileOptions | null>(null);
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState<"man" | "woman" | "">("");
  const [birthdate, setBirthdate] = useState("");
  const [bio, setBio] = useState("");
  const [county, setCounty] = useState("");
  const [town, setTown] = useState("");
  const [church, setChurch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [links, setLinks] = useState<{ url: string; label: string }[]>(
    Array.from({ length: 5 }, () => ({ url: "", label: "" })),
  );
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    setError(notice);
  }, [notice]);

  useEffect(() => {
    let cancel = false;
    void loadOwnProfile().then((result) => {
      if (cancel) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.profile.onboarded) {
        finished.current();
        return;
      }
      setProfile(result.profile);
      setOptions(result.options);
      setDisplayName(result.profile.displayName);
      if (result.profile.gender === "man" || result.profile.gender === "woman") {
        setGender(result.profile.gender);
      }
    });
    return () => {
      cancel = true;
    };
  }, []);

  const askName = Boolean(profile?.missing?.includes("displayName"));
  const askGender = !profile?.gender;
  const askBirth = !profile?.birthdateSet;
  const towns = options?.towns.filter((item) => item.county === county) ?? [];

  const addOptional = (payload: Record<string, unknown>) => {
    if (bio.trim()) payload.bio = bio.trim();
    if (town === "elsewhere") payload.location = { county: "", town: "elsewhere" };
    else if (county && town) payload.location = { county, town };
    if (church.trim()) payload.church = church.trim();
    if (picked.length) payload.interests = picked;
    const filled = links.filter((link) => link.url.trim());
    if (filled.length) {
      payload.links = filled.map((link) => ({ url: link.url.trim(), label: link.label.trim() }));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    submitWith(false);
  };

  const submitWith = (requiredOnly: boolean) => {
    if (!profile) return;
    if (askName && !displayName.trim()) {
      setError("Enter a display name.");
      return;
    }
    if (askGender && !gender) {
      setError("Say whether you are a man or a woman.");
      return;
    }
    if (askBirth && !birthdate) {
      setError("Enter a real birthdate.");
      return;
    }
    const payload: Record<string, unknown> = {};
    if (askName) payload.displayName = displayName.trim();
    if (askGender) payload.gender = gender;
    if (askBirth) payload.birthdate = birthdate;
    if (!requiredOnly) addOptional(payload);
    setBusy(true);
    setError("");
    void saveProfile("/api/profile/onboard", "POST", payload).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onFinished();
    });
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl xl:max-w-5xl">
      <Kicker>Your profile</Kicker>
      <h1 className="mt-2 font-display text-4xl text-fg">Finish your profile</h1>
      <p className="mt-3 max-w-2xl text-base text-muted">
        Only your name, gender and birthdate are needed now. Everything else is optional, and you
        can add it later from your profile. Finish this before you post, invite someone, or send a
        message.
      </p>
      <form className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={submit}>
        {askName ? (
          <Field
            label="Display name"
            hint="This can differ from the name you were vouched under. Admins still see that name."
          >
            <input
              className={inputClass}
              value={displayName}
              autoComplete="name"
              maxLength={80}
              required
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
        ) : (
          <p className="text-base text-fg md:col-span-2">
            Display name: <span className="font-semibold">{profile?.displayName}</span>
          </p>
        )}
        {askGender ? (
          <fieldset className="flex min-w-0 flex-col gap-2 md:col-span-2">
            <legend className="font-semibold text-fg">Gender</legend>
            <p className="text-muted">
              We ask so men's and women's rooms work. Members can see it. After this step it changes
              only if an admin approves a correction.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {(
                [
                  ["man", "Man"],
                  ["woman", "Woman"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line bg-surface px-4 text-base text-fg", choiceFocus)}
                >
                  <input
                    type="radio"
                    name="gender"
                    value={value}
                    checked={gender === value}
                    onChange={() => setGender(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {askBirth ? (
          <Field
            label="Birthdate"
            hint={`Members see your age, never this date. You need to be ${options?.minAge ?? 18}. After this step it changes only if an admin approves a correction.`}
          >
            <input
              className={inputClass}
              type="date"
              value={birthdate}
              autoComplete="bday"
              min="1900-01-01"
              max={latestBirthdate(options?.minAge ?? 18)}
              required
              onChange={(event) => setBirthdate(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Bio" hint="Optional.">
          <textarea
            className={cn(inputClass, "min-h-28")}
            value={bio}
            maxLength={600}
            onChange={(event) => setBio(event.target.value)}
          />
        </Field>
        <Field label="County" hint="Optional. Elsewhere is its own choice.">
          <select
            className={inputClass}
            value={county}
            onChange={(event) => {
              setCounty(event.target.value);
              setTown("");
            }}
          >
            <option value="">Not set</option>
            {options?.counties.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Town" hint="Optional.">
          <select
            className={inputClass}
            value={town}
            onChange={(event) => setTown(event.target.value)}
          >
            <option value="">Not set</option>
            <option value="elsewhere">{options?.elsewhere.name ?? "Elsewhere"}</option>
            {towns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Church or affiliation"
          hint="Optional. It helps suggest rooms. It is religious information, so you can choose who sees it from your profile, and you can clear it any time."
        >
          <input
            className={inputClass}
            value={church}
            list="church-rooms"
            maxLength={120}
            onChange={(event) => setChurch(event.target.value)}
          />
          <datalist id="church-rooms">
            {options?.churches.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <fieldset className="md:col-span-2">
          <legend className="font-semibold text-fg">Interests</legend>
          <p className="text-muted">Optional. Choose up to 12.</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {options?.interests.map((item) => {
              const on = picked.includes(item.id);
              return (
                <label
                  key={item.id}
                  className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line bg-surface px-3 text-base text-fg", choiceFocus)}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && picked.length >= 12}
                    onChange={() =>
                      setPicked((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id],
                      )
                    }
                  />
                  {item.label}
                </label>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-3 md:col-span-2">
          <legend className="font-semibold text-fg">Links</legend>
          <p className="text-muted">Optional. Up to five, and each one has to be https.</p>
          {links.map((link, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <input
                className={inputClass}
                type="url"
                inputMode="url"
                placeholder="https://"
                aria-label={`Link ${index + 1}`}
                value={link.url}
                onChange={(event) =>
                  setLinks((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, url: event.target.value } : row,
                    ),
                  )
                }
              />
              <input
                className={inputClass}
                placeholder="Label"
                aria-label={`Label ${index + 1}`}
                maxLength={80}
                value={link.label}
                onChange={(event) =>
                  setLinks((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, label: event.target.value } : row,
                    ),
                  )
                }
              />
            </div>
          ))}
        </fieldset>
        <div className="flex flex-col gap-3 md:col-span-2">
          <Notice>{error}</Notice>
          <button
            type="submit"
            className={cn(btnSignal, "w-full md:w-auto")}
            disabled={busy || !profile}
          >
            {busy ? "Saving" : "Finish your profile"}
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-line px-4 text-base text-fg md:w-auto",
              FOCUS,
            )}
            disabled={busy || !profile}
            onClick={() => submitWith(true)}
          >
            Skip optional fields for now
          </button>
        </div>
      </form>
    </div>
  );
}

function PhotoView({ photo, name }: { photo: MemberProfileBody["photo"]; name: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!photo?.id || photo.status !== "ready") {
      setUrl("");
      return;
    }
    let cancel = false;
    void apiFetch(`/api/media/${photo.id}`, { credentials: "include" }).then(async (response) => {
      if (!response.ok || cancel) return;
      const body = (await response.json().catch(() => null)) as {
        thumbUrl?: unknown;
        url?: unknown;
      } | null;
      const next = typeof body?.thumbUrl === "string" ? body.thumbUrl : body?.url;
      if (!cancel && typeof next === "string") setUrl(next);
    });
    return () => {
      cancel = true;
    };
  }, [photo?.id, photo?.status]);
  if (!photo) return <p className="text-muted">No photo yet.</p>;
  if (photo.status !== "ready" || !url) {
    return <p className="text-muted">Photo: {photo.status}</p>;
  }
  return (
    <img
      src={url}
      alt={`Profile photo of ${name}`}
      width={128}
      height={128}
      className="size-32 rounded-md border border-line bg-raised object-cover"
    />
  );
}

function PublicCard({ profile }: { profile: MemberProfileBody }) {
  const place = profile.location
    ? profile.location.town === "elsewhere"
      ? "Elsewhere"
      : [profile.location.townName, profile.location.countyName].filter(Boolean).join(", ")
    : "";
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <PhotoView photo={profile.photo} name={profile.displayName} />
      <h2 className="font-display text-3xl text-fg">{profile.displayName}</h2>
      {profile.vouchedName ? (
        <p className="text-muted">Vouched name, visible to admins: {profile.vouchedName}</p>
      ) : null}
      {profile.gender ? <p>Gender: {genderLabel(profile.gender)}</p> : null}
      {typeof profile.age === "number" ? <p>Age: {profile.age}</p> : null}
      {profile.bio ? <p className="max-w-2xl whitespace-pre-wrap">{profile.bio}</p> : null}
      {place ? <p>Town: {place}</p> : null}
      {profile.church ? <p>Church: {profile.church}</p> : null}
      {profile.interests && profile.interests.length > 0 ? (
        <p>Interests: {profile.interests.map((item) => item.label).join(", ")}</p>
      ) : null}
      {profile.links && profile.links.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {profile.links.map((link) => (
            <li key={link.url}>
              <a
                className="inline-flex min-h-[44px] items-center text-fg underline"
                href={link.url}
                target="_blank"
                rel="ugc nofollow noopener noreferrer"
              >
                {linkText(link)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function MemberProfile() {
  const [profile, setProfile] = useState<MemberProfileBody | null>(null);
  const [options, setOptions] = useState<ProfileOptions | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [county, setCounty] = useState("");
  const [town, setTown] = useState("");
  const [church, setChurch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [links, setLinks] = useState<{ url: string; label: string }[]>(
    Array.from({ length: 5 }, () => ({ url: "", label: "" })),
  );
  const [lookupId, setLookupId] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [looked, setLooked] = useState<MemberProfileBody | null>(null);

  const apply = (next: MemberProfileBody) => {
    setProfile(next);
    setDisplayName(next.displayName);
    setBio(next.bio ?? "");
    setCounty(next.location?.county ?? "");
    setTown(next.location?.town ?? "");
    setChurch(next.church ?? "");
    setPicked(next.interests?.map((item) => item.id) ?? []);
    const rows = Array.from(
      { length: 5 },
      (_, index) => next.links?.[index] ?? { url: "", label: "" },
    );
    setLinks(rows);
  };

  useEffect(() => {
    let cancel = false;
    void loadOwnProfile().then((result) => {
      if (cancel) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOptions(result.options);
      apply(result.profile);
    });
    return () => {
      cancel = true;
    };
  }, []);

  const towns = options?.towns.filter((item) => item.county === county) ?? [];

  const save = (event: FormEvent) => {
    event.preventDefault();
    const payload: Record<string, unknown> = {
      displayName: displayName.trim(),
      bio,
      church,
      interests: picked,
      links: links
        .filter((link) => link.url.trim())
        .map((link) => ({ url: link.url.trim(), label: link.label.trim() })),
    };
    if (town === "elsewhere") payload.location = { county: "", town: "elsewhere" };
    else if (!town) payload.location = null;
    else payload.location = { county, town };
    setBusy(true);
    setError("");
    setSaved("");
    void saveProfile("/api/profile", "PATCH", payload).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      apply(result.profile);
      setSaved("Saved");
    });
  };

  const setVisibility = (field: string, level: string) => {
    setError("");
    void saveProfile("/api/profile", "PATCH", { visibility: { [field]: level } }).then((result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      apply(result.profile);
      setSaved("Saved");
    });
  };

  const removePhoto = () => {
    setPhotoError("");
    setUploading(true);
    void removeOwnPhoto().then((result) => {
      setUploading(false);
      if (!result.ok) {
        setPhotoError(result.error);
        return;
      }
      apply(result.profile);
      setSaved("Photo removed");
    });
  };

  const onPhoto = (file: File | undefined) => {
    if (!file) return;
    if (file.type.startsWith("video/")) {
      setPhotoError("Choose a picture, not a video.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setPhotoError("Choose a JPEG, PNG, or WebP picture.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError("That picture is over 5 MB. Choose a smaller one.");
      return;
    }
    setUploading(true);
    setPhotoError("");
    void file.arrayBuffer().then(async (buffer) => {
      const uploaded = await uploadProfilePhoto({
        bytes: new Uint8Array(buffer),
        contentType: file.type || "application/octet-stream",
      });
      if (!uploaded.ok) {
        setUploading(false);
        setPhotoError(uploaded.error);
        return;
      }
      let ready = false;
      let waitError = "That picture is still processing. Refresh this page in a moment.";
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const response = await apiFetch(`/api/media/${uploaded.id}`, { credentials: "include" });
        const body = (await response.json().catch(() => null)) as {
          status?: unknown;
          error?: unknown;
        } | null;
        if (body?.status === "ready") {
          ready = true;
          break;
        }
        if (body?.status === "rejected") {
          waitError = typeof body.error === "string" ? body.error : "That picture was refused.";
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 400));
      }
      if (!ready) {
        setUploading(false);
        setPhotoError(waitError);
        return;
      }
      const attached = await attachProfilePhoto(uploaded.id);
      setUploading(false);
      if (!attached.ok) {
        setPhotoError(attached.error);
        return;
      }
      apply(attached.profile);
      setSaved("Saved");
    });
  };

  const lookup = (event: FormEvent) => {
    event.preventDefault();
    const id = lookupId.trim();
    if (!id) return;
    setLookupError("");
    setLooked(null);
    void loadMemberProfile(id).then((result) => {
      if (!result.ok) {
        setLookupError(result.error);
        return;
      }
      setLooked(result.profile);
    });
  };

  if (!profile || !options) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-3xl">
        <Notice>{error}</Notice>
        {error ? null : <p className="text-muted">Loading your profile.</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-8 xl:max-w-5xl">
      <section className="flex flex-col gap-3">
        <Kicker>You</Kicker>
        <h1 className="font-display text-4xl text-fg lg:text-5xl">{profile.displayName}</h1>
        {profile.vouchedName ? (
          <p className="max-w-2xl text-muted">
            Admins still see the vouched name: {profile.vouchedName}
          </p>
        ) : null}
        <PhotoView photo={profile.photo} name={profile.displayName} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <label
            aria-disabled={uploading || undefined}
            className={cn(
              "inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center self-start rounded-md bg-signal px-4 text-sm font-semibold text-signal-ink md:w-auto",
              choiceFocus,
              uploading && "pointer-events-none opacity-60",
            )}
          >
            {profile.photo ? "Replace photo" : "Add a photo"}
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={(event) => onPhoto(event.target.files?.[0])}
            />
          </label>
          {profile.photo ? (
            <button
              type="button"
              className={cn(
                "inline-flex min-h-[44px] items-center justify-center self-start rounded-md border border-line px-4 text-sm text-fg",
                FOCUS,
              )}
              disabled={uploading}
              onClick={removePhoto}
            >
              Remove photo
            </button>
          ) : null}
        </div>
        <p className="max-w-2xl text-muted">
          Optional. A JPEG, PNG, or WebP up to 5 MB. It does not have to show your face.
        </p>
        {uploading ? (
          <p role="status" className="text-muted">
            Uploading your photo…
          </p>
        ) : null}
        {photoError ? (
          <p role="alert" className="text-danger">
            {photoError}
          </p>
        ) : null}
      </section>
      <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={save}>
        <Field label="Display name" hint="This can differ from the name you were vouched under.">
          <input
            className={inputClass}
            value={displayName}
            autoComplete="name"
            maxLength={80}
            required
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        <p className="text-base text-fg">
          Gender: {genderLabel(profile.gender)}. To fix an entry mistake, ask for a correction below.
        </p>
        <p className="text-base text-fg">
          {typeof profile.age === "number" ? `Age: ${profile.age}` : "Age is not set."} Members see
          the age, not the date.
        </p>
        <Field label="Bio" hint="Optional.">
          <textarea
            className={cn(inputClass, "min-h-28")}
            value={bio}
            maxLength={600}
            onChange={(event) => setBio(event.target.value)}
          />
        </Field>
        <Field label="County" hint="Optional.">
          <select
            className={inputClass}
            value={county}
            onChange={(event) => {
              setCounty(event.target.value);
              setTown("");
            }}
          >
            <option value="">Not set</option>
            {options.counties.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Town" hint="Optional.">
          <select
            className={inputClass}
            value={town}
            onChange={(event) => setTown(event.target.value)}
          >
            <option value="">Not set</option>
            <option value="elsewhere">{options.elsewhere.name}</option>
            {towns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Church or affiliation" hint="Optional.">
          <input
            className={inputClass}
            value={church}
            list="own-church-rooms"
            maxLength={120}
            onChange={(event) => setChurch(event.target.value)}
          />
          <datalist id="own-church-rooms">
            {options.churches.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <fieldset className="md:col-span-2">
          <legend className="font-semibold text-fg">Interests</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {options.interests.map((item) => {
              const on = picked.includes(item.id);
              return (
                <label
                  key={item.id}
                  className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line bg-surface px-3", choiceFocus)}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && picked.length >= 12}
                    onChange={() =>
                      setPicked((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id],
                      )
                    }
                  />
                  {item.label}
                </label>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-3 md:col-span-2">
          <legend className="font-semibold text-fg">Links</legend>
          <p className="text-muted">Optional. Up to five. Each one has to be https. Nothing is previewed.</p>
          {links.map((link, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <input
                className={inputClass}
                type="url"
                inputMode="url"
                placeholder="https://"
                aria-label={`Link ${index + 1}`}
                value={link.url}
                onChange={(event) =>
                  setLinks((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, url: event.target.value } : row,
                    ),
                  )
                }
              />
              <input
                className={inputClass}
                placeholder="Label"
                aria-label={`Label ${index + 1}`}
                maxLength={80}
                value={link.label}
                onChange={(event) =>
                  setLinks((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, label: event.target.value } : row,
                    ),
                  )
                }
              />
            </div>
          ))}
        </fieldset>
        <div className="flex flex-col gap-3 md:col-span-2">
          <Notice>{error}</Notice>
          {saved ? (
            <p className="text-muted" role="status">
              {saved}
            </p>
          ) : null}
          <button type="submit" className={cn(btnSignal, "w-full md:w-auto")} disabled={busy}>
            {busy ? "Saving" : "Save profile"}
          </button>
        </div>
      </form>
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl text-fg">Who can see each field</h2>
        <p className="max-w-2xl text-muted">
          All members means anyone signed in to Avouch. People in a room with you means members who
          share a room or theme group with you; a direct message does not count. Only you means no
          other member. Every field starts at All members, and you can change any of them here.{" "}
          {options.adminsOnly} {options.anonymous}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {FIELDS.map((field) => {
            const current = profile.visibility?.[field.id] ?? "members";
            return (
              <fieldset key={field.id} className="flex min-w-0 flex-col gap-1">
                <legend className="font-semibold text-fg">{field.label}</legend>
                {current === "admins" ? <p className="text-muted">Now: admins only</p> : null}
                {VISIBILITY.map((choice) => (
                  <label
                    key={choice.id}
                    className={cn(
                      "inline-flex min-h-[44px] items-center gap-2 text-base text-fg",
                      choiceFocus,
                    )}
                  >
                    <input
                      type="radio"
                      name={`visibility-${field.id}`}
                      value={choice.id}
                      checked={current === choice.id}
                      onChange={() => setVisibility(field.id, choice.id)}
                    />
                    {choice.label}
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
      </section>
      <Corrections />
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl text-fg">Look up a member</h2>
        <form className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]" onSubmit={lookup}>
          <label className="flex min-w-0 flex-col gap-2">
            <span className="font-semibold">Member id (from their profile link)</span>
            <input
              className={inputClass}
              value={lookupId}
              autoComplete="off"
              onChange={(event) => setLookupId(event.target.value)}
            />
          </label>
          <button type="submit" className={cn(btnSignal, "self-end")}>
            Look up
          </button>
        </form>
        {lookupError ? (
          <p role="alert" className="text-danger">
            {lookupError}
          </p>
        ) : null}
        {looked ? <PublicCard profile={looked} /> : null}
      </section>
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  pending: "Waiting for an admin",
  approved: "Approved, your profile is updated",
  refused: "Not approved",
  withdrawn: "Withdrawn",
};

function Corrections() {
  const [own, setOwn] = useState<CorrectionRow[]>([]);
  const [queue, setQueue] = useState<CorrectionRow[] | null>(null);
  const [field, setField] = useState<"gender" | "birthdate">("gender");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const refresh = () => {
    void listCorrections("own").then((result) => {
      if (result.ok) setOwn(result.corrections);
    });
    void listCorrections("queue").then((result) => {
      setQueue(result.ok ? result.corrections : null);
    });
  };
  useEffect(refresh, []);

  const send = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setDone("");
    void askCorrection({ field, value, reason: reason.trim() }).then((result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setValue("");
      setReason("");
      setDone("Sent. A different admin will look at it.");
      refresh();
    });
  };

  const showRowError = (id: string, message: string) => {
    setRowError((current) => ({ ...current, [id]: message }));
    window.requestAnimationFrame(() => document.getElementById(`note-${id}`)?.focus());
  };

  const decide = (id: string, decision: "approve" | "refuse") => {
    const note = (notes[id] ?? "").trim();
    setRowError((current) => ({ ...current, [id]: "" }));
    if (decision === "refuse" && !note) {
      showRowError(id, "Write a note to the member before you refuse.");
      return;
    }
    void decideCorrection(id, decision, note).then((result) => {
      if (!result.ok) {
        showRowError(id, result.error);
        return;
      }
      refresh();
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-2xl text-fg">Fix a gender or birthdate mistake</h2>
      <p className="max-w-2xl text-muted">
        These are set when you finish your profile. If you entered one by mistake, ask for a
        correction. An admin other than you decides, and every step is logged.
      </p>
      <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={send}>
        <Field label="What to fix">
          <select
            className={inputClass}
            value={field}
            onChange={(event) => {
              setField(event.target.value === "birthdate" ? "birthdate" : "gender");
              setValue("");
            }}
          >
            <option value="gender">Gender</option>
            <option value="birthdate">Birthdate</option>
          </select>
        </Field>
        {field === "gender" ? (
          <Field label="Correct gender">
            <select
              className={inputClass}
              value={value}
              required
              onChange={(event) => setValue(event.target.value)}
            >
              <option value="">Choose</option>
              <option value="man">Man</option>
              <option value="woman">Woman</option>
            </select>
          </Field>
        ) : (
          <Field label="Correct birthdate" hint="Members still see only your age.">
            <input
              className={inputClass}
              type="date"
              value={value}
              required
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
        )}
        <Field label="What went wrong?">
          <input
            className={inputClass}
            value={reason}
            maxLength={300}
            required
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-2 md:col-span-2">
          <Notice>{error}</Notice>
          {done ? (
            <p role="status" className="text-muted">
              {done}
            </p>
          ) : null}
          <button type="submit" className={cn(btnSignal, "w-full md:w-auto", FOCUS)}>
            Ask for a correction
          </button>
        </div>
      </form>
      {own.length ? (
        <ul className="flex flex-col gap-1 text-muted">
          {own.map((row) => (
            <li key={row.id}>
              {row.field === "gender" ? "Gender" : "Birthdate"}: {STATUS_TEXT[row.status] ?? row.status}
              {row.decidedNote ? `. ${row.decidedNote}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {queue ? (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold text-fg">Correction requests to decide</h3>
          {queue.length === 0 ? <p className="text-muted">No correction requests are waiting.</p> : null}
          {queue.map((row) => (
            <div key={row.id} className="flex flex-col gap-2 rounded-lg border border-line p-3">
              <p className="text-fg">
                {row.name} asks to change {row.field === "gender" ? "Gender" : "Birthdate"} to{" "}
                {row.field === "gender" ? genderLabel(row.requestedValue === "woman" ? "woman" : "man") : row.requestedValue}. Reason:{" "}
                {row.reason}
              </p>
              <Field label="Note to the member (required to refuse)">
                <input
                  id={`note-${row.id}`}
                  aria-invalid={rowError[row.id] ? true : undefined}
                  aria-describedby={rowError[row.id] ? `err-${row.id}` : undefined}
                  className={inputClass}
                  value={notes[row.id] ?? ""}
                  maxLength={300}
                  onChange={(event) => setNotes({ ...notes, [row.id]: event.target.value })}
                />
              </Field>
              {rowError[row.id] ? (
                <p role="alert" id={`err-${row.id}`} className="text-danger">
                  {rowError[row.id]}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={cn(btnSignal, FOCUS)}
                  onClick={() => decide(row.id, "approve")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className={cn(
                    "inline-flex min-h-[44px] items-center rounded-md border border-line px-4 text-fg",
                    FOCUS,
                  )}
                  onClick={() => decide(row.id, "refuse")}
                >
                  Refuse
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
