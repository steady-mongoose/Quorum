import { useEffect, useState, type ReactNode } from "react";
import { LEVELS, type Level } from "@/lib/quorum/model";
import { cn } from "@/lib/cn";

/** The tab, pill and radio look used by every switcher in the app. */
export function pill(active: boolean, extra?: string) {
  return cn(
    "inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-40",
    active ? "bg-signal text-signal-ink" : "border border-line bg-surface text-muted",
    extra,
  );
}

export function IconNav<T extends string>({
  items,
  current,
  onSelect,
  label,
  className,
  itemClassName,
  iconClassName,
  children,
}: {
  items: { id: T; label: string; icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }> }[];
  current: T | string;
  onSelect: (id: T) => void;
  label: string;
  className?: string;
  itemClassName?: string;
  iconClassName?: string;
  children?: ReactNode;
}) {
  return (
    <nav className={cn("flex flex-wrap gap-2 lg:justify-end", className)} aria-label={label}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={current === item.id ? "page" : undefined}
            onClick={() => onSelect(item.id)}
            className={pill(current === item.id, itemClassName)}
          >
            {Icon ? <Icon className={cn("size-4", iconClassName)} aria-hidden="true" /> : null}
            {item.label}
          </button>
        );
      })}
      {children}
    </nav>
  );
}

export const btn =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-95 disabled:opacity-50 btn";

export const btnSignal = cn(btn, "btn-primary bg-signal text-signal-ink");
export const btnGhost = cn(btn, "border border-line bg-surface text-fg");
export const btnQuiet = cn(btn, "bg-transparent text-muted");

export const fieldClass =
  "w-full rounded-md border border-line-strong bg-raised px-3 py-3 text-base text-fg placeholder:text-muted focus-visible:border-fg";

export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export const COPY_FAILED = "Couldn't copy";

/** Idle label, "Copied", or "Couldn't copy" for one copy button. */
export function copyStatus(
  copied: string | null,
  failed: string | null,
  key: string,
  idle: string,
  done = "Copied",
): string {
  if (failed === key) return COPY_FAILED;
  if (copied === key) return done;
  return idle;
}

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  async function copy(key: string, text: string) {
    const ok = await writeClipboard(text);
    if (!ok) {
      setCopied((current) => (current === key ? null : current));
      setFailed(key);
      window.setTimeout(() => {
        setFailed((current) => (current === key ? null : current));
      }, 1600);
      return;
    }
    setFailed((current) => (current === key ? null : current));
    setCopied(key);
    window.setTimeout(() => {
      setCopied((current) => (current === key ? null : current));
    }, 1600);
  }
  return { copied, failed, copy };
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyWithTextarea(text);
  }
}

/** Used when the clipboard API is blocked. False means the copy did not land. */
function copyWithTextarea(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function Meter({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(max, 1)) * 100)));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-bg"
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label="Contacts logged against the quorum"
    >
      <div
        className="h-full rounded-full bg-signal transition-[width] duration-200 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function LevelSwitch({
  value,
  onChange,
}: {
  value: Level;
  onChange: (level: Level) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Level of government">
      {LEVELS.map((level) => (
        <button
          key={level.id}
          type="button"
          role="tab"
          aria-selected={value === level.id}
          onClick={() => onChange(level.id)}
          className={pill(value === level.id, "px-4")}
        >
          {level.label}
        </button>
      ))}
    </div>
  );
}

export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("kicker", className)}>{children}</p>
  );
}

/** A relative timestamp that re-renders itself, so its parent need not tick. */
export function When({ at, format }: { at: number; format: (at: number, now: number) => string }) {
  const now = useNow();
  return <>{now ? format(at, now.getTime()) : ""}</>;
}

export function Pips({ lit, tone }: { lit: number; tone: "signal" | "muted" }) {
  return (
    <div className="flex gap-1" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-8 flex-1 rounded-sm",
            index < lit
              ? tone === "signal"
                ? "bg-signal"
                : "bg-muted"
              : "border border-line bg-bg",
          )}
        />
      ))}
    </div>
  );
}
