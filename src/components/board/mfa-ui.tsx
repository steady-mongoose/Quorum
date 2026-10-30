import { useEffect, useId, useRef, useState } from "react";
import { btnGhost, btnSignal, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { useServerSession } from "@/lib/server-session-state";
import { HEADING_FOCUS_RING, PanelNote, usePanelRetry } from "@/components/board/panel-note";
import { MFA_RESETS_WAIT, PANEL_LOAD_FAILED, panelFailure } from "@/lib/board/load-failure";
import {
  approveMfaReset,
  confirmMfaEnroll,
  disableMfa,
  listMfaResets,
  MFA_RESETS_LOAD_FAILED,
  readMfaStatus,
  requestMfaReset,
  startMfaEnroll,
  stepUpMfa,
  type MfaResetRow,
  type MfaStatus,
} from "@/lib/mfa-api";

function QrMark({ modules }: { modules: number[][] }) {
  const size = modules.length;
  if (size < 21 || size > 177) return null;
  const cells = [];
  for (let y = 0; y < size; y += 1) {
    const row = modules[y];
    if (!row || row.length !== size) return null;
    for (let x = 0; x < size; x += 1) {
      if (row[x] === 1) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Authenticator QR code"
      className="h-auto w-full max-w-[17.5rem]"
    >
      <rect width={size} height={size} className="fill-parchment" />
      <g className="fill-ink">{cells}</g>
    </svg>
  );
}

function challengeError(message: string | undefined, recoveryMode: boolean): string {
  if (recoveryMode) return message || "That code is not valid.";
  if (message && /too many|wait/i.test(message)) return message;
  return "That code didn't match. Codes change every 30 seconds, so try the newest one.";
}

/** The disable field takes a six-digit code or a recovery code (letters, digits, a dash). */
export function disableCodeInput(raw: string): string {
  return raw.replace(/[^A-Za-z0-9 -]/g, "").slice(0, 16);
}

export function MfaChallenge({
  onSubmit,
}: {
  onSubmit: (code: string) => Promise<{ ok: boolean; message?: string }>;
}) {
  const fieldId = useId();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function send(value: string) {
    if (pending || !value.trim()) return;
    setError("");
    setPending(true);
    void onSubmit(value).then((result) => {
      setPending(false);
      if (!result.ok) setError(challengeError(result.message, recovery));
    });
  }

  return (
    <form
      className="flex w-full flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        send(String(data.get("code") ?? ""));
      }}
    >
      <h2 className="text-2xl text-fg">Authenticator</h2>
      <p className="text-sm text-muted">
        {recovery
          ? "Enter one recovery code. It works once."
          : "Enter the six-digit code from your authenticator app."}
      </p>
      <label className="flex flex-col gap-2 text-sm text-muted" htmlFor={fieldId}>
        {recovery ? "Recovery code" : "Code"}
        <input
          id={fieldId}
          name="code"
          className={cn(fieldClass, "min-h-[44px] font-mono tracking-widest")}
          value={code}
          inputMode={recovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          maxLength={recovery ? undefined : 6}
          pattern={recovery ? undefined : "[0-9]*"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            const raw = event.target.value;
            const next = recovery ? raw : raw.replace(/\D/g, "").slice(0, 6);
            if (event.target.value !== next) event.target.value = next;
            setCode(next);
            if (!recovery && /^\d{6}$/.test(next)) event.currentTarget.form?.requestSubmit();
          }}
        />
      </label>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button type="submit" className={cn(btnSignal, "w-full sm:w-auto")} disabled={pending}>
        {recovery ? "Use recovery code" : "Continue"}
      </button>
      <button
        type="button"
        className="inline-flex min-h-[44px] items-center self-start px-1 text-sm text-signal underline"
        onClick={() => {
          setRecovery(!recovery);
          setCode("");
          setError("");
        }}
      >
        {recovery ? "Use an authenticator code" : "Use a recovery code"}
      </button>
    </form>
  );
}

export function MfaSettings() {
  // The session's phase (server.mfa) drives About's Admin lists card and the top
  // banner. It is read when the session loads, so read it again whenever this
  // panel turns the authenticator on or off.
  const { refreshPhase } = useServerSession();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [modules, setModules] = useState<number[][] | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("Copied.");
      setError("");
    } catch {
      setCopied("");
      setError("Copy did not work. Select the text and copy it.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    void readMfaStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [recovery]);

  const refresh = () => {
    void readMfaStatus().then(setStatus);
  };

  return (
    <section className="flex w-full flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-5 md:max-w-xl xl:max-w-3xl">
      <h2 id="authenticator" tabIndex={-1} className="focus-target text-2xl text-fg">
        Authenticator
      </h2>
      <p className="max-w-prose text-sm text-muted">
        Adds a six-digit code from an app on your phone after your password. Owners, admins and
        stewards need it for sensitive actions. Members can turn it on any time.
      </p>
      {status?.required && !status.enrolled ? (
        <p className="text-sm text-fg">Turn this on before you use steward or admin tools.</p>
      ) : null}
      {status?.enrolled ? (
        <p className="text-sm text-muted">
          On. {status.recoveryRemaining} recovery {status.recoveryRemaining === 1 ? "code" : "codes"}{" "}
          left. Each works once.
        </p>
      ) : null}
      {!status?.enrolled && !modules && !recovery ? (
        <button
          type="button"
          className={cn(btnSignal, "w-full sm:w-auto")}
          disabled={pending}
          onClick={() => {
            setError("");
            setPending(true);
            void startMfaEnroll().then((result) => {
              setPending(false);
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setSecret(result.value.secret);
              setModules(result.value.modules);
            });
          }}
        >
          Turn on authenticator
        </button>
      ) : null}
      {modules && !status?.enrolled ? (
        <div className="flex flex-col gap-3">
          <QrMark modules={modules} />
          <p className="text-sm text-muted">Can't scan? Enter this key in your app:</p>
          <p className="break-all font-mono text-base tracking-wider text-fg select-all">
            {secret.match(/.{1,4}/g)?.join(" ")}
          </p>
          <button
            type="button"
            className={cn(btnGhost, "min-h-[44px] w-full sm:w-auto")}
            onClick={() => void copyValue(secret)}
          >
            Copy key
          </button>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Code from the app
            <input
              className={cn(fieldClass, "min-h-[44px] font-mono tracking-widest")}
              value={code}
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]*"
              autoComplete="one-time-code"
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </label>
          <button
            type="button"
            className={cn(btnSignal, "w-full sm:w-auto")}
            disabled={pending}
            onClick={() => {
              setError("");
              setPending(true);
              void confirmMfaEnroll(code).then((result) => {
                setPending(false);
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                setSavedCodes(false);
                setCopied("");
                setRecovery(result.value.recoveryCodes);
                setModules(null);
                setSecret("");
                setCode("");
                refresh();
                void refreshPhase();
              });
            }}
          >
            Confirm code
          </button>
        </div>
      ) : null}
      {recovery ? (
        <div className="flex flex-col gap-3">
          <p className="text-base text-fg">
            Save these 10 recovery codes now. They are shown only once. Each works one time if you
            lose your phone. Keep them somewhere safe, apart from your password.
          </p>
          <ol className="grid grid-cols-1 gap-2 rounded-md border border-line bg-raised p-3 font-mono tabular-nums sm:grid-cols-2">
            {recovery.map((item) => (
              <li key={item} className="text-base text-fg">
                {item}
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className={cn(btnGhost, "min-h-[44px] w-full sm:w-auto")}
              onClick={() => void copyValue(recovery.join("\n"))}
            >
              Copy codes
            </button>
            <button
              type="button"
              className={cn(btnGhost, "min-h-[44px] w-full sm:w-auto")}
              onClick={() => downloadRecoveryCodes(recovery)}
            >
              Download .txt
            </button>
          </div>
          <label className="flex min-h-[44px] items-center gap-3 text-base text-fg">
            <input
              type="checkbox"
              className="size-6 shrink-0"
              checked={savedCodes}
              onChange={(event) => setSavedCodes(event.target.checked)}
            />
            I've saved these codes
          </label>
          <button
            type="button"
            className={cn(btnSignal, "w-full sm:w-auto")}
            disabled={!savedCodes}
            onClick={() => {
              setRecovery(null);
              setSavedCodes(false);
              setCopied("");
            }}
          >
            Continue
          </button>
        </div>
      ) : null}
      {status?.enrolled && !status.required && !recovery ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            setNotice("");
            setPending(true);
            void disableMfa(code).then((result) => {
              setPending(false);
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setCode("");
              setNotice("Authenticator is off.");
              refresh();
              void refreshPhase();
            });
          }}
        >
          <label className="flex flex-col gap-2 text-sm text-muted">
            Six-digit code or a recovery code
            <input
              className={cn(fieldClass, "min-h-[44px] font-mono tracking-widest")}
              value={code}
              inputMode="text"
              maxLength={16}
              autoComplete="one-time-code"
              onChange={(event) => setCode(disableCodeInput(event.target.value))}
            />
          </label>
          <button type="submit" className={cn(btnGhost, "w-full sm:w-auto")} disabled={pending}>
            Turn off authenticator
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {copied ? (
        <p role="status" className="text-sm text-muted">
          {copied}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function downloadRecoveryCodes(codes: string[]) {
  const blob = new Blob([`${codes.join("\n")}\n`], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "avouch-recovery-codes.txt";
  link.click();
  URL.revokeObjectURL(url);
}

function waitingCopy(count: number): string {
  const left = Math.max(0, 2 - count);
  if (left >= 2) return "Waiting on 2 admins";
  if (left === 1) return "Waiting on 1 more admin";
  return "Both approvals are in";
}

function queueStatus(row: MfaResetRow): string {
  const names = row.approvals
    .map((item) => item.approverName)
    .filter((name) => typeof name === "string" && name.length > 0);
  const approved = names.length === 0 ? "" : `Approved by ${names.join(" and ")} · `;
  return `Asked by ${row.requesterName} · ${approved}${waitingCopy(row.approvals.length)}`;
}

function approveBlock(row: MfaResetRow, viewerId: string): string | null {
  if (!viewerId) return "Sign in again before approving.";
  if (viewerId === row.userId) return "You cannot approve a reset of your own account.";
  if (viewerId === row.requestedBy) return "You asked for this reset, so someone else approves it.";
  if (row.approvals.some((item) => item.approverId === viewerId)) {
    return "You already approved this. A different admin has to approve it.";
  }
  return null;
}

export function MfaResetQueue({ onSetUp }: { onSetUp?: () => void } = {}) {
  const viewerId = useServerSession().user?.id ?? "";
  const [rows, setRows] = useState<MfaResetRow[] | null>(null);
  const [userId, setUserId] = useState("");
  const [code, setCode] = useState("");
  // role=alert is kept for what a submit or an approval says went wrong. Why the
  // queue did not load is a PanelNote inside the panel, never a page alert.
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const { tick, failure, busy: retrying, retry, loaded, failed, retriedOnce } = usePanelRetry(heading);
  const [refresh, setRefresh] = useState(0);
  const load = () => setRefresh((value) => value + 1);

  useEffect(() => {
    let cancel = false;
    void listMfaResets().then((result) => {
      if (cancel) return;
      if (!result.ok) {
        // A bare code (the message falls back to it) never reaches the page, and
        // nor does the API's own fallback: every load failure that is not the
        // authenticator gate says "That did not load.", as on the other lists.
        const said =
          result.message === result.error || result.message === MFA_RESETS_LOAD_FAILED ? "" : result.message;
        failed(panelFailure({ error: result.error, message: said }, PANEL_LOAD_FAILED));
        return;
      }
      setRows(result.value.resets);
      loaded();
    });
    return () => {
      cancel = true;
    };
  }, [tick, refresh, failed, loaded]);

  return (
    <section className="flex w-full flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-5 md:max-w-xl xl:max-w-3xl">
      <h2 ref={heading} tabIndex={-1} className={`text-2xl text-fg ${HEADING_FOCUS_RING}`}>
        Authenticator reset
      </h2>
      <p className="max-w-prose text-sm text-muted">
        Two different admins approve. The person who asked cannot approve, and nobody approves a
        reset of their own account. The owner counts as an admin. Enter a fresh code first.
      </p>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setNotice("");
          setPending(true);
          void requestMfaReset(userId.trim()).then((result) => {
            setPending(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setNotice("Reset asked for.");
            setUserId("");
            load();
          });
        }}
      >
        <label className="flex flex-col gap-2 text-sm text-muted md:col-span-2">
          Member's account ID
          <span className="text-sm text-muted">Find it on the member's profile.</span>
          <input
            className={cn(fieldClass, "min-h-[44px]")}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          />
        </label>
        <button type="submit" className={cn(btnSignal, "w-full sm:w-auto")} disabled={pending}>
          Ask for a reset
        </button>
      </form>
      <label className="flex flex-col gap-2 text-sm text-muted">
        Fresh authenticator code
        <input
          className={cn(fieldClass, "min-h-[44px] font-mono tracking-widest")}
          value={code}
          inputMode="numeric"
          maxLength={6}
          pattern="[0-9]*"
          autoComplete="one-time-code"
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </label>
      <PanelNote
        failure={failure}
        gateText={MFA_RESETS_WAIT}
        onRetry={retry}
        onSetUp={onSetUp}
        busy={retrying}
        live={retriedOnce}
      />
      {!failure && rows && rows.length === 0 ? <p className="text-sm text-muted">No resets are waiting.</p> : null}
      <ul className="flex flex-col gap-3">
        {(rows ?? []).map((row) => {
          const blocked = approveBlock(row, viewerId);
          return (
            <li key={row.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
              <p className="text-base text-fg">
                {row.name} <span className="text-muted">{row.email}</span>
              </p>
              <p className="text-sm text-muted">{queueStatus(row)}</p>
              <button
                type="button"
                className={cn(btnGhost, "w-full sm:w-auto")}
                disabled={pending || Boolean(blocked)}
                onClick={() => {
                  setError("");
                  setNotice("");
                  setPending(true);
                  void (async () => {
                    const stepped = await stepUpMfa("mfa-reset", code.trim());
                    if (!stepped.ok) {
                      setPending(false);
                      setError(stepped.message);
                      return;
                    }
                    const result = await approveMfaReset(row.id);
                    setPending(false);
                    if (!result.ok) {
                      setError(result.message);
                      return;
                    }
                    setNotice(result.value.completed ? "Reset finished." : "Approval saved.");
                    load();
                  })();
                }}
              >
                Approve reset
              </button>
              {blocked ? <p className="text-sm text-muted">{blocked}</p> : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
