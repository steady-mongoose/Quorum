import { useEffect, useRef, useState } from "react";
import { btnSignal, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  entryFromSearch,
  INVITE_CODE_ERROR,
  INVITE_CODE_ERROR_ID,
  inviteCodeError,
} from "@/lib/board/invite-entry";
import { MfaChallenge } from "@/components/board/mfa-ui";
import { SIGNED_UP_NO_SESSION } from "@/lib/account-result";
import { useServerSession } from "@/lib/server-session-state";

type FieldKey = "name" | "email" | "password";
const FIELD_ERRORS: Record<FieldKey, string> = {
  name: "Please enter your name.",
  email: "Please enter your email.",
  password: "Please enter your password.",
};

/** Account door. Shown only when the dedicated-box API answered. */
export function AccountDoor() {
  const server = useServerSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const refs = {
    name: useRef<HTMLInputElement | null>(null),
    email: useRef<HTMLInputElement | null>(null),
    password: useRef<HTMLInputElement | null>(null),
  };
  const fieldProps = (key: FieldKey) => ({
    ref: refs[key],
    "aria-invalid": fieldErrors[key] ? true : undefined,
    "aria-describedby": fieldErrors[key] ? `door-${key}-error` : undefined,
  });
  const fieldError = (key: FieldKey) =>
    fieldErrors[key] ? (
      <p id={`door-${key}-error`} role="alert" className="text-sm text-danger">
        {fieldErrors[key]}
      </p>
    ) : null;
  const clearError = (key: FieldKey) =>
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));

  useEffect(() => {
    const entry = entryFromSearch(window.location.search);
    if (!entry.code) return;
    setCode(entry.code);
    setMode("sign-up");
  }, []);

  if (server.mfa === "challenge") {
    return (
      <div
        id="sign-in"
        className="flex flex-col gap-3 rounded-lg border border-signal bg-surface p-5 sm:p-6"
      >
        <MfaChallenge onSubmit={(code) => server.finishMfa(code)} />
      </div>
    );
  }

  return (
    <form
      id="sign-in"
      className="flex flex-col gap-3 rounded-lg border border-signal bg-surface p-5 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        setOutcome(null);
        const order: FieldKey[] =
          mode === "sign-up" ? ["name", "email", "password"] : ["email", "password"];
        const values: Record<FieldKey, string> = { name, email, password };
        const empty = order.filter((key) => !values[key].trim());
        if (empty.length > 0) {
          setFieldErrors(Object.fromEntries(empty.map((key) => [key, FIELD_ERRORS[key]])));
          refs[empty[0]].current?.focus();
          return;
        }
        setFieldErrors({});
        if (mode === "sign-up" && !code.trim()) {
          setCodeError(INVITE_CODE_ERROR);
          return;
        }
        setCodeError(null);
        setPending(true);
        const run =
          mode === "sign-in"
            ? server.signIn({ email, password })
            : server.signUp({ name, email, password, inviteCode: code });
        void run.then((result) => {
          setPending(false);
          if (!result.ok) {
            if (result.code === SIGNED_UP_NO_SESSION) {
              setMode("sign-in");
              setCode("");
              setOutcome(result.message);
              return;
            }
            const aboutCode = mode === "sign-up" ? inviteCodeError(code, result) : null;
            if (aboutCode) setCodeError(aboutCode);
            else setOutcome(result.message);
          }
        });
      }}
    >
      <h2 className="text-2xl text-fg">{mode === "sign-in" ? "Sign in" : "Use an invite code"}</h2>
      <p className="text-sm text-muted">
        There is no open sign-up. A member gives you a code, and that code is how an account is
        created.
      </p>
      {mode === "sign-up" ? (
        <>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Your name, as people know you
            <input
              className={fieldClass}
              value={name}
              {...fieldProps("name")}
              onChange={(event) => {
                setName(event.target.value);
                clearError("name");
              }}
              autoComplete="name"
            />
          </label>
          {fieldError("name")}
        </>
      ) : null}
      <label className="flex flex-col gap-2 text-sm text-muted">
        Email
        <input
          className={fieldClass}
          type="email"
          value={email}
          {...fieldProps("email")}
          onChange={(event) => {
            setEmail(event.target.value);
            clearError("email");
          }}
          autoComplete="email"
        />
      </label>
      {fieldError("email")}
      <label className="flex flex-col gap-2 text-sm text-muted">
        Password
        <input
          className={fieldClass}
          type="password"
          value={password}
          {...fieldProps("password")}
          onChange={(event) => {
            setPassword(event.target.value);
            clearError("password");
          }}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        />
      </label>
      {fieldError("password")}
      {mode === "sign-up" ? (
        <>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Invite code
            <input
              id="invite-code"
              className={cn(fieldClass, "font-mono tracking-widest uppercase")}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setCodeError(null);
              }}
              autoComplete="off"
              aria-invalid={codeError ? true : undefined}
              aria-describedby={codeError ? INVITE_CODE_ERROR_ID : undefined}
            />
          </label>
          {codeError ? (
            <p id={INVITE_CODE_ERROR_ID} role="alert" className="text-sm text-danger">
              {codeError}
            </p>
          ) : null}
        </>
      ) : null}
      <button type="submit" className={cn(btnSignal, "self-start")} disabled={pending}>
        {mode === "sign-in" ? "Sign in" : "Create the account"}
      </button>
      <button
        type="button"
        className="inline-flex min-h-[44px] items-center self-start px-1 text-sm text-signal underline"
        onClick={() => {
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
          setOutcome(null);
          setFieldErrors({});
          setCodeError(null);
        }}
      >
        {mode === "sign-in" ? "I have a code" : "I already have an account"}
      </button>
      {outcome ? (
        <p className="text-sm text-fg" role="alert">
          {outcome}
        </p>
      ) : null}
    </form>
  );
}
