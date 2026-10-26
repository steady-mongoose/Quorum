import { useState } from "react";
import { btnGhost, fieldClass } from "@/components/quorum/bits";
import { audienceLabel } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

/** A plain label. Empty when the room is for everyone. */
export function RoomAudienceMark({ audience }: { audience?: string | null }) {
  const label = audienceLabel(audience);
  if (!label) return null;
  return <span className="text-[0.8125rem] text-muted">{label}</span>;
}

export function GenderPrompt({ onSet }: { onSet: (gender: "man" | "woman") => void }) {
  return (
    <form className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <p className="max-w-prose text-sm text-muted">
        Say whether you are a man or a woman. A room can be limited to one. You set this once.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGhost} onClick={() => onSet("man")}>
          I am a man
        </button>
        <button type="button" className={btnGhost} onClick={() => onSet("woman")}>
          I am a woman
        </button>
      </div>
    </form>
  );
}

/** Shown when this member still has to state a gender, or a steward must confirm it. */
export function GenderGate() {
  const remote = useBoard((state) => state.remote);
  const member = useBoard((state) => state.member);
  const gender = useBoard((state) => state.gender);
  const genderConfirmed = useBoard((state) => state.genderConfirmed);
  const genderSetBy = useBoard((state) => state.genderSetBy);
  const needsConfirmation = useBoard((state) => state.genderNeedsConfirmation);
  const setGender = useBoard((state) => state.setGender);
  const [error, setError] = useState("");
  if (!remote || !member) return null;
  if (!gender && genderSetBy === "self") {
    return (
      <div className="mb-6 flex flex-col gap-2">
        <GenderPrompt
          onSet={(next) => {
            setError("");
            void setGender(next).then((result) => {
              if (!result.ok) setError(result.error ?? "That was not saved.");
            });
          }}
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }
  if (!gender && genderSetBy === "inviter") {
    return (
      <p className="mb-6 text-sm text-muted">The person who invited you sets whether you are a man or a woman.</p>
    );
  }
  if (!gender && genderSetBy === "steward") {
    return <p className="mb-6 text-sm text-muted">A steward sets whether you are a man or a woman.</p>;
  }
  if (gender && needsConfirmation && !genderConfirmed) {
    return <p className="mb-6 text-sm text-muted">A steward has not confirmed that yet.</p>;
  }
  return null;
}

export function RoomAudienceEditor({
  audience,
  onSave,
}: {
  audience: "all" | "men" | "women";
  onSave: (audience: "all" | "men" | "women") => void | Promise<{ ok: boolean; error?: string } | void>;
}) {
  const [value, setValue] = useState(audience);
  const [error, setError] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        void Promise.resolve(onSave(value)).then((result) => {
          if (result && result.ok === false) setError(result.error ?? "That was not saved.");
        });
      }}
    >
      <label className="flex flex-col gap-2 text-sm text-muted">
        Who can be in this room
        <select
          className={fieldClass}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "all" || next === "men" || next === "women") setValue(next);
          }}
        >
          <option value="all">Everyone</option>
          <option value="men">Men only</option>
          <option value="women">Women only</option>
        </select>
      </label>
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
      else setNote("Saved.");
    });
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <h3 className="text-lg text-fg">A member's gender</h3>
      <p className="max-w-prose text-sm text-muted">
        The member sets it once. A steward changes it after that.
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
          Man
        </button>
        <button type="button" className={btnGhost} onClick={() => send("woman")}>
          Woman
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
                else setNote("Confirmed.");
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
