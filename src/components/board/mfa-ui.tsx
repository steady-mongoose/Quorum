import { useEffect, useState } from "react";
import { btnGhost, btnSignal, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  approveMfaReset,
  confirmMfaEnroll,
  disableMfa,
  listMfaResets,
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

export function MfaChallenge({
  onSubmit,
}: {
  onSubmit: (code: string) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="flex w-full flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setPending(true);
        void onSubmit(code).then((result) => {
          setPending(false);
          if (!result.ok) setError(result.message ?? "That code is not valid.");
        });
      }}
    >
      <h2 className="font-display text-2xl text-fg">Authenticator</h2>
      <p className="text-sm text-muted">
        {recovery
          ? "Enter one recovery code. It works once."
          : "Enter the six-digit code from your authenticator app."}
      </p>
      <label className="flex flex-col gap-2 text-sm text-muted">
        {recovery ? "Recovery code" : "Code"}
        <input
          className={cn(fieldClass, "min-h-[44px] font-mono tracking-widest")}
          value={code}
          inputMode={recovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
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
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function MfaSettings() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [modules, setModules] = useState<number[][] | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

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
      <h2 className="font-display text-2xl text-fg">Authenticator</h2>
      <p className="max-w-prose text-sm text-muted">
        A code from an app you keep, after your password. The owner, an admin, and a steward of a
        room need one before they grant a role, approve a reset, or export. A member can turn it
        on. A passkey can be added later.
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
      {!status?.enrolled && !modules ? (
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
          <p className="text-sm text-muted">Or enter this key by hand.</p>
          <p className="break-all font-mono text-base text-fg">{secret}</p>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Code from the app
            <input
              className={cn(fieldClass, "min-h-[44px] font-mono tracking-widest")}
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              onChange={(event) => setCode(event.target.value)}
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
                setRecovery(result.value.recoveryCodes);
                setModules(null);
                setSecret("");
                setCode("");
                refresh();
              });
            }}
          >
            Confirm code
          </button>
        </div>
      ) : null}
      {recovery ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg">Write these down. They are shown once.</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {recovery.map((item) => (
              <li key={item} className="font-mono text-base text-fg">
                {item}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={cn(btnGhost, "w-full sm:w-auto")}
            onClick={() => setRecovery(null)}
          >
            I wrote them down
          </button>
        </div>
      ) : null}
      {status?.enrolled && !status.required ? (
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
            });
          }}
        >
          <label className="flex flex-col gap-2 text-sm text-muted">
            Code to turn it off
            <input
              className={cn(fieldClass, "min-h-[44px] font-mono tracking-widest")}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
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
      {notice ? (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

export function MfaResetQueue() {
  const [rows, setRows] = useState<MfaResetRow[] | null>(null);
  const [userId, setUserId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  const load = () => {
    void listMfaResets().then((result) => {
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRows(result.value.resets);
    });
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="flex w-full flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-5 md:max-w-xl xl:max-w-3xl">
      <h2 className="font-display text-2xl text-fg">Authenticator reset</h2>
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
          Account id
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
          autoComplete="one-time-code"
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <ul className="flex flex-col gap-3">
        {(rows ?? []).map((row) => (
          <li key={row.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
            <p className="text-base text-fg">
              {row.name} <span className="text-muted">{row.email}</span>
            </p>
            <p className="text-sm text-muted">
              Asked by {row.requesterName}. {row.approvals.length} of 2 approvals.
            </p>
            <button
              type="button"
              className={cn(btnGhost, "w-full sm:w-auto")}
              disabled={pending}
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
          </li>
        ))}
      </ul>
      {rows && rows.length === 0 ? <p className="text-sm text-muted">No reset is waiting.</p> : null}
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
