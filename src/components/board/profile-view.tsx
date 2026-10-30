import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { AccountRemoval } from "@/components/board/account-removal";
import { btnQuiet, fieldClass, Kicker } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { authorName, cardSummary, formatDate, namedLines, stoodWith } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { MfaSettings } from "@/components/board/mfa-ui";
import { PlaceSearch } from "@/components/board/place-search";
import { useServerSession } from "@/lib/server-session-state";
import { loadAccountChurch, saveAccountChurch } from "@/lib/places/client";

/** Shown under a picked church, so members know who sees the address. */
export const CHURCH_ADDRESS_NOTE =
  "Others see the church name. The address shows only where your location does.";

function churchKey(name: string, place: { ref: string; address: string } | null): string {
  return JSON.stringify([name.trim(), place?.ref ?? "", place?.address ?? ""]);
}

/**
 * Household, church, trade, plus who you have met, what you host, and
 * when a host mentioned you. Visible only to people who have been to the
 * same meeting as you; everyone else sees a name.
 */
export function ProfileView() {
  const rawMe = useBoard((state) => state.me);
  const me = authorName(rawMe);
  const setMe = useBoard((state) => state.setMe);
  const viewing = useBoard((state) => state.viewing);
  const profile = useBoard((state) => state.profile);
  const setProfile = useBoard((state) => state.setProfile);
  const deskOn = useBoard((state) => state.deskOn);
  const setDeskOn = useBoard((state) => state.setDeskOn);
  const [knownAs, setKnownAs] = useState(rawMe);
  const [household, setHousehold] = useState(profile.household);
  const [parish, setParish] = useState(profile.parish);
  const [parishPlace, setParishPlace] = useState(profile.parishPlace ?? null);
  const [trade, setTrade] = useState(profile.trade);
  const [saved, setSaved] = useState(false);
  const skipSave = useRef(true);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    setSaved(false);
    const save = window.setTimeout(() => {
      setProfile({ household, parish, parishPlace, trade });
      const next = knownAs.trim();
      if (next) {
        const current = useBoard.getState();
        if (authorName(current.viewing ?? "") === authorName(current.me)) {
          useBoard.setState({ viewing: next });
        }
        setMe(next);
      }
      setSaved(true);
    }, 600);
    const hide = window.setTimeout(() => setSaved(false), 2600);
    return () => {
      window.clearTimeout(save);
      window.clearTimeout(hide);
    };
  }, [household, parish, parishPlace, trade, knownAs, setProfile, setMe]);
  const server = useServerSession();
  const live = server.mode === "live" && Boolean(server.user);
  // The church also lives on the account (PATCH /api/profile), so a picked
  // place follows the member to another device. Until migration 0048 is
  // applied the server keeps the name only, and the pick stays on this device.
  const [churchNote, setChurchNote] = useState("");
  const syncedChurch = useRef<string | null>(null);
  const [churchLoaded, setChurchLoaded] = useState(false);

  useEffect(() => {
    if (!live) return;
    let stop = false;
    void loadAccountChurch()
      .then((account) => {
        if (stop || !account) return;
        syncedChurch.current = churchKey(account.name, account.place);
        setChurchLoaded(true);
        // No church on the account yet: the one on this device is saved up.
        if (!account.name) return;
        setParish(account.name);
        // A pick kept only on this device stays when the server has none for the same name.
        setParishPlace((local) =>
          account.place ?? (local && account.name === profile.parish ? local : null),
        );
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
    // Read once per sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, server.user?.id]);

  useEffect(() => {
    if (!live || !churchLoaded || syncedChurch.current === null) return;
    const key = churchKey(parish, parishPlace);
    if (key === syncedChurch.current) return;
    setChurchNote("");
    const timer = window.setTimeout(() => {
      void saveAccountChurch(parish.trim(), parishPlace)
        .then((answer) => {
          if (!answer.ok) {
            setChurchNote("That did not save.");
            return;
          }
          syncedChurch.current = key;
          if (answer.note === "not-confirmed") {
            // The server could not match the pick to a recent search, so it
            // kept the church as typed. Show it that way here too.
            syncedChurch.current = churchKey(parish.trim(), null);
            setParishPlace(null);
            setChurchNote(
              "Saved the church name as typed. To put it on the map, search and choose it again.",
            );
          } else if (parishPlace && !answer.church?.place) {
            setChurchNote(
              "Saved the church name. The map pick stays on this device until saving places is turned on.",
            );
          } else if (answer.church?.place) {
            // The saved name and address are the server's, from OpenStreetMap.
            const saved = answer.church;
            syncedChurch.current = churchKey(saved.name, saved.place);
            if (saved.name !== parish) setParish(saved.name);
            if (saved.place && saved.place.address !== parishPlace?.address) {
              setParishPlace(saved.place);
            }
          }
        })
        .catch(() => setChurchNote("That did not save."));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [live, churchLoaded, parish, parishPlace]);

  const cards = useBoard((state) => state.cards);
  const posts = useBoard((state) => state.posts);
  const openDm = useBoard((state) => state.openDm);
  const name = viewing?.trim() || me;
  const mine = name === me;

  const peers = useMemo(() => stoodWith(me, cards, posts), [me, cards, posts]);
  const allowed = mine || peers.has(name);
  const theirs = useMemo(() => stoodWith(name, cards, posts), [name, cards, posts]);
  const hosts = cards.filter((card) => card.host === name && card.kind !== "trade" && card.kind !== "need");
  const named = useMemo(() => namedLines(name, posts), [name, posts]);

  if (!allowed) {
    return (
      <div className="flex flex-col gap-3">
        <Kicker>Profile</Kicker>
        <h1 className="illum font-display text-4xl text-fg">{name}</h1>
        <p className="max-w-2xl text-base text-muted">You can see a profile once you have been to the same meeting as that person. You and {name} have not been to one yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 lg:max-w-4xl">
      <section className="flex flex-col gap-2">
        <Kicker>{mine ? "You" : "Profile"}</Kicker>
        <h1 className="illum font-display text-4xl text-fg lg:text-5xl">{name}</h1>
        {mine ? (
          <p className="max-w-prose text-sm text-muted">Your household, church, and trade. Only people who have been to the same meeting as you can see this page; to everyone else you are a name.</p>
        ) : null}
        {mine ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-2 text-sm text-muted sm:col-span-3">
              Name, as people know you
              <input
                className={cn(fieldClass, "min-h-[44px]")}
                placeholder="Josh"
                autoComplete="name"
                value={knownAs}
                onChange={(event) => setKnownAs(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Household
              <input
                className={cn(fieldClass, "min-h-[44px]")}
                placeholder="the McMullins"
                value={household}
                onChange={(event) => setHousehold(event.target.value)}
              />
            </label>
            <PlaceSearch
              label="Church"
              kind="church"
              value={{
                name: parish,
                ref: parishPlace?.ref ?? null,
                address: parishPlace?.address ?? "",
              }}
              onChange={(next) => {
                setParish(next.name);
                setParishPlace(next.ref ? { ref: next.ref, address: next.address } : null);
              }}
              pickedNote={CHURCH_ADDRESS_NOTE}
            />
            <label className="flex flex-col gap-2 text-sm text-muted">
              Trade
              <input
                className={cn(fieldClass, "min-h-[44px]")}
                placeholder="Electrician"
                value={trade}
                onChange={(event) => setTrade(event.target.value)}
              />
            </label>
            {saved ? (
              <p role="status" className="text-sm text-muted sm:col-span-3">
                Saved
              </p>
            ) : null}
            {churchNote ? (
              <p role="status" className="text-sm text-muted sm:col-span-3">
                {churchNote}
              </p>
            ) : null}
          </div>
        ) : null}
        {mine ? (
          <section className="mt-4 flex flex-col gap-2">
            <h2 className="text-2xl text-fg">The desk</h2>
            <p className="max-w-prose text-sm text-muted">
              Optional: coordinated calls to local officials. It stays off until you turn it on.
              The emblems stay.
            </p>
            <label className="inline-flex min-h-[44px] items-center gap-3 text-sm text-fg">
              <input
                type="checkbox"
                className="size-5"
                checked={deskOn}
                onChange={(event) => setDeskOn(event.target.checked)}
              />
              Show The desk
            </label>
          </section>
        ) : null}
        {!mine ? (
          <button type="button" className={btnQuiet + " self-start px-0"} onClick={() => openDm(name)}>
            <MessageSquare className="size-4" aria-hidden="true" />
            Message {name}
          </button>
        ) : null}
      </section>

      {named.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xl text-fg">Mentioned by a host</h2>
          <p className="text-sm text-muted">A host can single out one person after each meeting. The last few times that was {mine ? "you" : name}:</p>
          <ul className="flex flex-col gap-2">
            {named.map((post) => (
              <li key={post.id} className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
                <span className="text-fg">{post.claim}</span>
                <span className="text-muted">
                  {" "}
                  · {post.author}, {formatDate(post.on)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hosts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xl text-fg">{mine ? "Meetings you host" : `Meetings ${name} hosts`}</h2>
          <ul className="flex flex-col gap-2">
            {hosts.map((card) => (
              <li key={card.id} className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
                <span className="text-fg">{card.name}</span> <span className="text-muted">· {cardSummary(card)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-2xl text-fg">{mine ? "People you've met here" : `People ${name} has met here`}</h2>
        <p className="text-sm text-muted">{theirs.size === 0 ? "Nobody yet. Go to a meeting." : [...theirs].join(", ")}</p>
      </section>

      {mine && server.mode === "live" ? <MfaSettings /> : null}
      {mine ? (
        <div className="border-t border-line pt-6">
          <AccountRemoval live={server.mode === "live" && Boolean(server.user)} />
        </div>
      ) : null}
    </div>
  );
}
