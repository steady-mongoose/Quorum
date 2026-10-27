import { useState } from "react";
import { btnGhost, fieldClass } from "@/components/quorum/bits";
import { audienceLabel } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

const AUDIENCE_OPTIONS = [
  { value: "all", label: "Everyone", detail: "Any member can join." },
  { value: "men", label: "Men only", detail: "Only members who've said they're men can join." },
  { value: "women", label: "Women only", detail: "Only members who've said they're women can join." },
] as const;

export type AudienceValue = (typeof AUDIENCE_OPTIONS)[number]["value"];

/** Outline badge. The first child is the screen-reader name. */
export function RoomAudienceMark({ audience }: { audience?: string | null }) {
  const label = audienceLabel(audience);
  if (!label) return null;
  return (
    <span className="ml-2 inline-flex items-center rounded-full border border-muted px-2 py-0.5 text-[0.8125rem] text-muted">
      <span className="sr-only">Audience: </span>
      {label}
    </span>
  );
}

/** Shown in a restricted room when this member has not stated a gender. */
export function GenderPrompt({
  onSet,
  onDismiss,
  error,
}: {
  onSet: (gender: "man" | "woman") => void;
  onDismiss: () => void;
  error?: string;
}) {
  return (
    <fieldset className="plate flex flex-col gap-3 p-4">
      <legend className="illum font-display text-3xl text-fg">To open men's and women's rooms</legend>
      <p className="text-sm text-muted max-w-prose">
        Some rooms are for men or for women only. We ask only so you can enter them. You set this
        once; after that, an admin can change it for you.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGhost} onClick={() => onSet("man")}>
          I'm a man
        </button>
        <button type="button" className={btnGhost} onClick={() => onSet("woman")}>
          I'm a woman
        </button>
        <button type="button" className={btnGhost} onClick={onDismiss}>
          Not now
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export function AudienceChoice({
  legend,
  name,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  value: AudienceValue;
  onChange: (value: AudienceValue) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm text-muted">{legend}</legend>
      {AUDIENCE_OPTIONS.map((option) => (
        <label key={option.value} className="flex gap-3 min-h-11 items-start">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>
            {option.label}
            <br />
            <small className="text-muted">{option.detail}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function RoomAudienceEditor({
  audience,
  onSave,
}: {
  audience: AudienceValue;
  onSave: (audience: AudienceValue) => void | Promise<{ ok: boolean; error?: string } | void>;
}) {
  const [value, setValue] = useState(audience);
  const [error, setError] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        void Promise.resolve(onSave(value)).then((result) => {
          if (result && result.ok === false) setError(result.error ?? "That was not saved.");
        });
      }}
    >
      <AudienceChoice legend="Who can be in this room" name="audience" value={value} onChange={setValue} />
      <button type="submit" className={btnGhost}>
        Save
      </button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** A restricted room the member cannot open yet, or a room that is not here. */
export function RoomHoldPlate({
  code,
  onDismiss,
}: {
  code: "gender-unstated" | "gender-unconfirmed" | "missing";
  onDismiss: () => void;
}) {
  const setBy = useBoard((state) => state.genderSetBy);
  const setGender = useBoard((state) => state.setGender);
  const [error, setError] = useState("");
  if (code === "missing") {
    return <p className="plate p-4 text-sm text-muted">That room is not here.</p>;
  }
  if (code === "gender-unconfirmed") {
    return (
      <p className="plate p-4 text-sm text-muted">
        A steward will confirm this soon. Until then, men's and women's rooms stay closed to you.
      </p>
    );
  }
  if (setBy === "inviter") {
    return (
      <p className="plate p-4 text-sm text-muted">
        The person who invited you sets whether you are a man or a woman. Ask a steward if this
        needs changing.
      </p>
    );
  }
  if (setBy === "steward") {
    return (
      <p className="plate p-4 text-sm text-muted">
        A steward sets whether you are a man or a woman. Ask a steward if this needs changing.
      </p>
    );
  }
  return (
    <GenderPrompt
      error={error}
      onDismiss={onDismiss}
      onSet={(next) => {
        setError("");
        void setGender(next).then((result) => {
          if (!result.ok) setError(result.error ?? "That was not saved.");
        });
      }}
    />
  );
}

export function MemberGenderForm() {
  const setMemberGender = useBoard((state) => state.setMemberGender);
  const confirmGender = useBoard((state) => state.confirmGender);
  const needsConfirmation = useBoard((state) => state.genderNeedsConfirmation);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const send = (gender: "man" | "woman") => {
    setError("");
    setNote("");
    void setMemberGender({ email, gender }).then((result) => {
      if (!result.ok) setError(result.error ?? "That was not saved.");
      else setNote(`Saved for ${email}.`);
    });
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <h3 className="text-lg text-fg">Set a member's gender</h3>
      <p className="max-w-prose text-sm text-muted">
        The member sets it once. An admin changes it after that. No one changes their own.
      </p>
      <label className="flex flex-col gap-2 text-sm text-muted">
        Email
        <input
          className={fieldClass}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGhost} onClick={() => send("man")}>
          Set as man
        </button>
        <button type="button" className={btnGhost} onClick={() => send("woman")}>
          Set as woman
        </button>
        {needsConfirmation ? (
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              setError("");
              setNote("");
              void confirmGender(email).then((result) => {
                if (!result.ok) setError(result.error ?? "That was not confirmed.");
                else setNote(`Saved for ${email}.`);
              });
            }}
          >
            Confirm
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {note ? (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      ) : null}
    </form>
  );
}
