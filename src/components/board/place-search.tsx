import { useEffect, useId, useRef, useState } from "react";
import { fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  isVerified,
  OSM_ATTRIBUTION,
  OSM_COPYRIGHT_URL,
  PLACE_DEBOUNCE_MS,
  PLACE_MIN_QUERY,
  roundNear,
  searchPlaces,
  type PlaceKind,
  type PlaceSearchFn,
  type PlaceSuggestion,
  type PlaceValue,
} from "@/lib/places/client";

type GeoLike = Pick<Geolocation, "getCurrentPosition">;

type Status = "idle" | "loading" | "done" | "error";
type LocationState = "unasked" | "asking" | "granted" | "declined";

const NOT_LISTED = "not-listed";

function defaultGeo(): GeoLike | null {
  if (typeof navigator === "undefined") return null;
  return navigator.geolocation ?? null;
}

/**
 * Type-ahead search for a church or a local group, from OpenStreetMap.
 *
 * - Suggestions come from our API after 300ms and 3 letters.
 * - Location is asked for only when the field is focused, kept in memory,
 *   rounded, and used only to sort nearest first. Declining shows a
 *   city or ZIP box that does the same job.
 * - "Not listed, type it in" is always offered. A typed entry has no
 *   reference and is not marked verified.
 * - A picked place shows "Verified place" and its address.
 *
 * Reusable: the claim listing search and the This Week "Your place" field
 * can render this with kind "church" or "organization".
 */
export function PlaceSearch({
  label,
  kind,
  value,
  onChange,
  search = searchPlaces,
  geolocation,
  className,
}: {
  label: string;
  kind: PlaceKind;
  value: PlaceValue;
  onChange: (next: PlaceValue) => void;
  search?: PlaceSearchFn;
  /** Null turns location off, as when the browser has none. */
  geolocation?: GeoLike | null;
  className?: string;
}) {
  const base = useId();
  const inputId = `${base}-input`;
  const listId = `${base}-list`;
  const nearId = `${base}-near`;
  const [text, setText] = useState(value.name);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const [locationState, setLocationState] = useState<LocationState>("unasked");
  const [nearText, setNearText] = useState("");
  // The point lives only in this component's memory and is never saved.
  const near = useRef<{ lat: number; lon: number } | null>(null);
  const [nearVersion, setNearVersion] = useState(0);
  const focused = useRef(false);
  const geo = geolocation === undefined ? defaultGeo() : geolocation;

  useEffect(() => {
    if (!focused.current && value.name !== text) setText(value.name);
    // Only an outside change to the saved value resets the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.name]);

  const query = text.trim();
  const picked = isVerified(value) && value.name === text;

  useEffect(() => {
    if (!open || picked || query.length < PLACE_MIN_QUERY) {
      setStatus("idle");
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus("loading");
      setError("");
      void search(
        { q: query, kind, near: near.current, nearText: near.current ? "" : nearText },
        controller.signal,
      )
        .then((answer) => {
          if (controller.signal.aborted) return;
          if (answer.ok) {
            setResults(answer.places);
            setStatus("done");
          } else {
            setResults([]);
            setError(answer.error);
            setStatus("error");
          }
          setActive(-1);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults([]);
          setError("Place search is not answering. Choose Not listed to type it in.");
          setStatus("error");
        });
    }, PLACE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, picked, query, kind, nearText, nearVersion, search]);

  const options: { id: string; place: PlaceSuggestion | null }[] = [
    ...results.map((place, index) => ({ id: `${base}-opt-${index}`, place })),
    ...(query ? [{ id: `${base}-${NOT_LISTED}`, place: null }] : []),
  ];
  const expanded = open && options.length > 0;

  function askLocation() {
    if (locationState !== "unasked") return;
    if (!geo) {
      setLocationState("declined");
      return;
    }
    setLocationState("asking");
    try {
      geo.getCurrentPosition(
        (position) => {
          near.current = roundNear({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          });
          setLocationState("granted");
          setNearVersion((n) => n + 1);
        },
        () => setLocationState("declined"),
        { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 8000 },
      );
    } catch {
      setLocationState("declined");
    }
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    if (option.place) {
      onChange({ name: option.place.name, ref: option.place.ref, address: option.place.address });
      setText(option.place.name);
    } else {
      onChange({ name: query, ref: null, address: "" });
      setText(query);
    }
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      if (options.length) setActive((current) => (current + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      if (options.length) setActive((current) => (current <= 0 ? options.length - 1 : current - 1));
    } else if (event.key === "Enter") {
      if (expanded && active >= 0) {
        event.preventDefault();
        choose(active);
      }
    } else if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  const announce =
    !open || query.length < PLACE_MIN_QUERY || picked
      ? ""
      : status === "loading"
        ? "Searching"
        : status === "error"
          ? error
          : status === "done" && results.length > 0
            ? "Places found. Use the up and down arrows to choose one."
            : status === "done"
              ? "No places found. Choose Not listed to type it in."
              : "";

  return (
    <div className={cn("relative flex flex-col gap-2 text-sm text-muted", className)}>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? options[active]?.id : undefined}
        aria-describedby={picked ? `${base}-verified` : undefined}
        autoComplete="off"
        spellCheck={false}
        className={cn(fieldClass, "min-h-[44px]")}
        value={text}
        onFocus={() => {
          focused.current = true;
          askLocation();
        }}
        onBlur={() => {
          focused.current = false;
          setOpen(false);
          setActive(-1);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          setOpen(true);
          setActive(-1);
          // Typing replaces a picked place. Until a place is picked again,
          // the entry is saved as typed and is not verified.
          onChange({ name: next.trim(), ref: null, address: "" });
        }}
        onKeyDown={onKeyDown}
      />

      <div
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-30 mt-1 rounded-md border border-line-strong bg-raised shadow-lg"
      >
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="flex max-h-72 flex-col overflow-y-auto overscroll-contain py-1"
        >
          {options.map((option, index) => (
            <li
              key={option.id}
              id={option.id}
              role="option"
              aria-selected={index === active}
              className={cn(
                "flex min-h-[44px] cursor-pointer flex-col justify-center px-3 py-2",
                index === active
                  ? "bg-surface text-fg outline-2 -outline-offset-2 outline-[var(--color-fg)]"
                  : "text-fg",
                option.place ? "" : "border-t border-line",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              {option.place ? (
                <>
                  <span className="text-base">{option.place.name}</span>
                  {option.place.address ? (
                    <span className="text-sm text-muted">{option.place.address}</span>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="text-base">Not listed, type it in</span>
                  <span className="text-sm text-muted">Saves “{query}” as you typed it</span>
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          Place data{" "}
          <a
            className="underline"
            href={OSM_COPYRIGHT_URL}
            target="_blank"
            rel="noreferrer"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
          >
            {OSM_ATTRIBUTION}
          </a>
        </p>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      {status === "error" && open ? <p className="text-sm text-muted">{error}</p> : null}

      {locationState === "declined" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={nearId}>Near (city or ZIP), to list the closest first</label>
          <input
            id={nearId}
            className={cn(fieldClass, "min-h-[44px]")}
            autoComplete="postal-code"
            value={nearText}
            onChange={(event) => setNearText(event.target.value)}
          />
        </div>
      ) : null}

      {picked ? (
        <p id={`${base}-verified`} className="text-sm text-muted">
          <span className="text-fg">Verified place</span>
          {value.address ? <> · {value.address}</> : null}
          <span className="block text-xs">
            Place data{" "}
            <a className="underline" href={OSM_COPYRIGHT_URL} target="_blank" rel="noreferrer">
              {OSM_ATTRIBUTION}
            </a>
          </span>
        </p>
      ) : null}
    </div>
  );
}
