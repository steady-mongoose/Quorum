import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { btnQuiet, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { FIELD_HINT } from "@/lib/board/field-hints";
import {
  isOnMap,
  OSM_ATTRIBUTION,
  OSM_COPYRIGHT_URL,
  PLACE_DEBOUNCE_MS,
  PLACE_ERROR_DOWN,
  PLACE_MIN_QUERY,
  PLACE_PROVIDER_HOST,
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
/** "Searching" is announced only when a search is still running after this long. */
export const SEARCHING_ANNOUNCE_MS = 1000;
/** Matches max-height:min(18rem,40dvh) on .place-pop, for the open-upward check. */
const POP_REM = 18;
const POP_VH = 0.4;

/** House ring for the input and links; .focus-target is the shared class from #114. */
const RING =
  "focus-target focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[currentColor]";

function defaultGeo(): GeoLike | null {
  if (typeof navigator === "undefined") return null;
  return navigator.geolocation ?? null;
}

/** The phone tabbar's height when it is showing, else 0. */
function tabbarHeight(): number {
  if (typeof document === "undefined") return 0;
  const bar = document.querySelector<HTMLElement>(".tabbar");
  if (!bar || getComputedStyle(bar).display === "none") return 0;
  return bar.getBoundingClientRect().height || 0;
}

/**
 * Type-ahead search for a church or a local group, from OpenStreetMap.
 *
 * - Suggestions come from our API after 300ms and 3 letters. Our API sends
 *   the words to Photon (photon.komoot.io); the field says so.
 * - Location is never asked for on focus. Only "List the nearest first"
 *   asks. The point is kept in memory, rounded, and used only to sort.
 *   If the browser says no, a "Near a town or ZIP" box does the same job.
 * - "Not listed, type it in" is always offered. A typed entry has no
 *   reference and no mark.
 * - A picked place shows "On the map · {address}". It means the name
 *   matches an OpenStreetMap entry, nothing more.
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
  hint = FIELD_HINT.church,
  pickedNote,
}: {
  label: string;
  kind: PlaceKind;
  value: PlaceValue;
  onChange: (next: PlaceValue) => void;
  search?: PlaceSearchFn;
  /** Null turns location off, as when the browser has none. */
  geolocation?: GeoLike | null;
  className?: string;
  /** Instruction tied to the input with aria-describedby. */
  hint?: string;
  /** Extra line under a picked place, such as who sees the address. */
  pickedNote?: string;
}) {
  const base = useId();
  const inputId = `${base}-input`;
  const listId = `${base}-list`;
  const nearId = `${base}-near`;
  const hintId = `${base}-hint`;
  const providerId = `${base}-provider`;
  const onMapId = `${base}-onmap`;
  const [text, setText] = useState(value.name);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const [upward, setUpward] = useState(false);
  const [locationState, setLocationState] = useState<LocationState>("unasked");
  const [nearText, setNearText] = useState("");
  // The point lives only in this component's memory and is never saved.
  const near = useRef<{ lat: number; lon: number } | null>(null);
  const [nearVersion, setNearVersion] = useState(0);
  const focused = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const geo = geolocation === undefined ? defaultGeo() : geolocation;

  useEffect(() => {
    if (!focused.current && value.name !== text) setText(value.name);
    // Only an outside change to the saved value resets the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.name]);

  const query = text.trim();
  const picked = isOnMap(value) && value.name === text;
  const searchable = open && !picked && query.length >= PLACE_MIN_QUERY;

  useEffect(() => {
    if (!searchable) {
      setStatus("idle");
      setResults([]);
      return;
    }
    // A visible "Searching…" row shows from the first pause, so "Not
    // listed" is never the only row while the first answer is on its way.
    setStatus("loading");
    setError("");
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
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
          setError(PLACE_ERROR_DOWN);
          setStatus("error");
        });
    }, PLACE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchable, query, kind, nearText, nearVersion, search]);

  // Announce "Searching" only when a search is still running after a second.
  useEffect(() => {
    setSlow(false);
    if (status !== "loading") return;
    const timer = window.setTimeout(() => setSlow(true), SEARCHING_ANNOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [status, query]);

  const options: { id: string; place: PlaceSuggestion | null }[] = [
    ...(status === "loading" ? [] : results).map((place, index) => ({
      id: `${base}-opt-${index}`,
      place,
    })),
    { id: `${base}-${NOT_LISTED}`, place: null },
  ];
  const expanded = searchable;

  // When the list opens: open it upward if it would not fit above the
  // tabbar and the keyboard, then keep it in view.
  useLayoutEffect(() => {
    if (!expanded) return;
    const input = inputRef.current;
    if (input && typeof window !== "undefined") {
      const rect = input.getBoundingClientRect();
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const want = Math.min(POP_REM * rem, viewport * POP_VH) + 48;
      const below = viewport - tabbarHeight() - rect.bottom;
      const above = rect.top;
      setUpward(below < want && above > below);
    }
    popRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [expanded]);

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
      if (expanded) setActive((current) => (current + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      if (expanded) setActive((current) => (current <= 0 ? options.length - 1 : current - 1));
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

  const found = results.length;
  const announce = !expanded
    ? ""
    : status === "loading"
      ? slow
        ? "Searching"
        : ""
      : status === "error"
        ? error
        : status === "done" && found > 0
          ? `${found} ${found === 1 ? "place" : "places"} found. Use the up and down arrows to choose one.`
          : status === "done"
            ? "No places found. Choose Not listed to type it in."
            : "";

  const describedBy = [hintId, providerId, picked ? onMapId : ""].filter(Boolean).join(" ");

  return (
    <div className={cn("relative flex flex-col gap-2 text-sm text-muted", className)}>
      <label htmlFor={inputId}>{label}</label>
      <p id={hintId} className="text-sm text-muted">
        {hint}
      </p>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? options[active]?.id : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          spellCheck={false}
          className={cn(fieldClass, "min-h-[44px] w-full", RING)}
          value={text}
          onFocus={() => {
            // Never ask for location here. Only the button below asks.
            focused.current = true;
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
            // the entry is saved as typed and has no map mark.
            onChange({ name: next.trim(), ref: null, address: "" });
          }}
          onKeyDown={onKeyDown}
        />

        <div
          ref={popRef}
          hidden={!expanded}
          data-upward={upward ? "true" : undefined}
          className={cn(
            "place-pop absolute inset-x-0 z-30 flex flex-col overflow-hidden rounded-md border border-line-strong bg-raised shadow-lg",
            upward ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {status === "error" ? (
            <p className="border-b border-line px-3 py-2 text-sm text-muted">{error}</p>
          ) : null}
          {status === "loading" ? (
            <p className="px-3 py-2 text-sm text-muted">Searching…</p>
          ) : null}
          <ul
            id={listId}
            role="listbox"
            aria-label={`${label} suggestions`}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain py-1"
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
          {/* A visible credit while the list is open. It is plain text, so
              the popup holds only the listbox; the link is just below. */}
          <p className="border-t border-line px-3 py-2 text-xs text-muted">
            Place data {OSM_ATTRIBUTION}
          </p>
        </div>
      </div>

      <p id={providerId} className="text-xs text-muted">
        Searches go from our server to Photon ({PLACE_PROVIDER_HOST}), a free search of
        OpenStreetMap. So do a town or ZIP and a rough location, if you give them. Our server
        holds your search words for up to 10 minutes and the places shown for up to an hour,
        in memory only, so it can save the one you choose. It never keeps your location.
        Place data{" "}
        {/* Outside the listbox and the popup, so Tab reaches it from the field. */}
        <a className={cn("underline", RING)} href={OSM_COPYRIGHT_URL} target="_blank" rel="noreferrer">
          {OSM_ATTRIBUTION}
        </a>
      </p>

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      {locationState === "unasked" || locationState === "asking" ? (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className={cn(btnQuiet, "self-start", RING)}
            onClick={askLocation}
            disabled={locationState === "asking"}
            aria-describedby={`${base}-near-why`}
          >
            List the nearest first
          </button>
          <p id={`${base}-near-why`} className="text-xs text-muted">
            Your rough location sorts this list and is not kept.
          </p>
        </div>
      ) : null}

      {locationState === "granted" ? (
        <p className="text-xs text-muted">
          Nearest first, from your rough location. It is not kept.
        </p>
      ) : null}

      {locationState === "declined" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={nearId}>Near a town or ZIP</label>
          <input
            id={nearId}
            className={cn(fieldClass, "min-h-[44px]", RING)}
            autoComplete="off"
            aria-describedby={`${nearId}-hint`}
            value={nearText}
            onChange={(event) => setNearText(event.target.value)}
          />
          <p id={`${nearId}-hint`} className="text-xs text-muted">
            Only used to sort this list. Not kept.
          </p>
        </div>
      ) : null}

      {picked ? (
        <p id={onMapId} className="text-sm text-muted">
          <span className="text-[var(--gold)]">On the map</span>
          {value.address ? <> · {value.address}</> : null}
          {pickedNote ? <span className="block">{pickedNote}</span> : null}
          <span className="block text-xs">Place data {OSM_ATTRIBUTION}</span>
        </p>
      ) : null}
    </div>
  );
}

