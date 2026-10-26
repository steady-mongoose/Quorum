import { useEffect, useRef, useState } from "react";
import { btnSignal, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  entryFromSearch,
  INVITE_CODE_ERROR,
  INVITE_CODE_ERROR_ID,
  inviteCodeError,
} from "@/lib/board/invite-entry";
import { useServerSession } from "@/lib/server-session-state";

export const SIGN_IN_EMPTY_ERROR = "Enter your email and password.";
export const SIGN_IN_MISMATCH_ERROR = "That email and password don't match an account.";
export const SIGN_IN_ERROR_ID = "sign-in-error";
export const CODE_MODE_INTRO = "Enter the code your host gave you.";

const fieldLabel = "flex flex-col gap-2 text-base text-fg";

function focusFirst(fields: Array<HTMLInputElement | null>) {
  for (const field of fields) {
    if (!field) continue;
    field.focus();
    return;
  }
}

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
  const [signAlert, setSignAlert] = useState<"empty" | "mismatch" | null>(null);
  const [nameInvalid, setNameInvalid] = useState(false);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [passwordInvalid, setPasswordInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const signMessage =
    signAlert === "empty"
      ? SIGN_IN_EMPTY_ERROR
      : signAlert === "mismatch"
        ? SIGN_IN_MISMATCH_ERROR
        : null;

  useEffect(() => {
    const entry = entryFromSearch(window.location.search);
    if (!entry.code) return;
    setCode(entry.code);
    setMode("sign-up");
  }, []);

  return (
    <form
      id="sign-in"
      noValidate
      className="flex flex-col gap-3 rounded-lg border border-signal bg-surface p-5 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        setOutcome(null);
        const nameBlank = mode === "sign-up" && !name.trim();
        const emailBlank = !email.trim();
        const passwordBlank = !password.trim();
        setNameInvalid(nameBlank);
        if (emailBlank || passwordBlank) {
          setEmailInvalid(emailBlank);
          setPasswordInvalid(passwordBlank);
          setSignAlert("empty");
          focusFirst([
            nameBlank ? nameRef.current : null,
            emailBlank ? emailRef.current : null,
            passwordBlank ? passwordRef.current : null,
          ]);
          return;
        }
        if (mode === "sign-up" && !code.trim()) {
          setSignAlert(null);
          setEmailInvalid(false);
          setPasswordInvalid(false);
          setCodeError(INVITE_CODE_ERROR);
          focusFirst([nameBlank ? nameRef.current : null, codeRef.current]);
          return;
        }
        setCodeError(null);
        setSignAlert(null);
        setEmailInvalid(false);
        setPasswordInvalid(false);
        setPending(true);
        const run =
          mode === "sign-in"
            ? server.signIn({ email, password })
            : server.signUp({ name, email, password, inviteCode: code });
        void run.then((result) => {
          setPending(false);
          if (!result.ok) {
            const aboutCode = mode === "sign-up" ? inviteCodeError(code, result) : null;
            if (aboutCode) {
              setCodeError(aboutCode);
              focusFirst([nameBlank ? nameRef.current : null, codeRef.current]);
            } else if (mode === "sign-in") {
              setSignAlert("mismatch");
              setEmailInvalid(true);
              setPasswordInvalid(true);
              focusFirst([emailRef.current]);
            } else {
              setOutcome(result.message);
              focusFirst([nameBlank ? nameRef.current : null, emailRef.current]);
            }
          }
        });
      }}
    >
      <h2 className="text-2xl text-fg">{mode === "sign-in" ? "Sign in" : "Use an invite code"}</h2>
      {mode === "sign-up" ? <p className="text-base text-muted">{CODE_MODE_INTRO}</p> : null}
      {mode === "sign-up" ? (
        <label className={fieldLabel}>
          Your name, as people know you
          <input
            id="sign-up-name"
            ref={nameRef}
            className={fieldClass}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameInvalid(false);
            }}
            autoComplete="name"
            required
            aria-invalid={nameInvalid ? true : undefined}
          />
        </label>
      ) : null}
      <label className={fieldLabel}>
        Email
        <input
          id="sign-in-email"
          ref={emailRef}
          className={fieldClass}
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailInvalid(false);
            setSignAlert((current) => (passwordInvalid ? current : null));
          }}
          autoComplete="email"
          required
          aria-invalid={emailInvalid ? true : undefined}
          aria-describedby={signMessage ? SIGN_IN_ERROR_ID : undefined}
        />
      </label>
      <label className={fieldLabel}>
        Password
        <input
          id="sign-in-password"
          ref={passwordRef}
          className={fieldClass}
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setPasswordInvalid(false);
            setSignAlert((current) => (emailInvalid ? current : null));
          }}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          required
          aria-invalid={passwordInvalid ? true : undefined}
          aria-describedby={signMessage ? SIGN_IN_ERROR_ID : undefined}
        />
      </label>
      {mode === "sign-up" ? (
        <>
          <label className={fieldLabel}>
            Invite code
            <input
              id="invite-code"
              ref={codeRef}
              className={cn(fieldClass, "font-mono tracking-widest uppercase")}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setCodeError(null);
              }}
              autoComplete="off"
              required
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
      {signMessage ? (
        <p id={SIGN_IN_ERROR_ID} role="alert" className="text-sm text-danger">
          {signMessage}
        </p>
      ) : null}
      {outcome ? (
        <p role="alert" className="text-sm text-danger">
          {outcome}
        </p>
      ) : null}
      <button type="submit" className={cn(btnSignal, "self-start")} disabled={pending}>
        {mode === "sign-in" ? "Sign in" : "Create the account"}
      </button>
      {/* TODO: Restore the agreement line when the real Terms and Privacy text ships.
          By creating an account you agree to the Terms and Privacy notice. */}
      <button
        type="button"
        className="inline-flex min-h-[44px] items-center self-start px-1 text-sm text-signal underline"
        onClick={() => {
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
          setOutcome(null);
          setCodeError(null);
          setSignAlert(null);
          setNameInvalid(false);
          setEmailInvalid(false);
          setPasswordInvalid(false);
        }}
      >
        {mode === "sign-in" ? "I have a code" : "I already have an account"}
      </button>
    </form>
  );
}
