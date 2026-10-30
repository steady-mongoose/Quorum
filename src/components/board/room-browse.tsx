import { useMemo, useState } from "react";
import { RoomOptionsMenu } from "@/components/board/room-options-menu";
import { DEFAULT_ROOM_OPTIONS, type RoomOption } from "@/lib/board/room-options";
import { Link } from "@tanstack/react-router";
import { btnGhost, btnSignal, fieldClass, pill } from "@/components/quorum/bits";
import { getBoardClient } from "@/lib/board/client";
import {
  UNCATEGORIZED_SLUG,
  audienceLabel,
  browseCategories,
  categoryListed,
  groupBrowseRooms,
  categoryNames,
  hiddenRooms,
  meetsLabel,
  nextGatheringOn,
  orderBrowseRooms,
  roomCategoryIds,
  type BrowseRoom,
  type RoomCategory,
} from "@/lib/board/categories";
import { todayIso, type Room } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { reloadCategories, useCategories } from "@/components/board/use-categories";

/**
 * Rooms by category. Phone: a sticky chip row, then sections.
 * Desktop: a 14rem sticky list beside a container-sized card grid.
 * /rooms/<slug> is the shareable page for one category. Members only.
 * Room cards are not plates, so the hero margin does not stack them.
 */
export function RoomBrowse({ focusSlug }: { focusSlug: string | null }) {
  const rooms = useBoard((state) => state.rooms);
  const cards = useBoard((state) => state.cards);
  const steward = useBoard((state) => state.steward);
  const admin = useBoard((state) => state.admin);
  const remote = useBoard((state) => state.remote);
  const stewardRooms = useBoard((state) => state.stewardRooms);
  const setRoom = useBoard((state) => state.setRoom);
  const categories = useCategories();
  const today = todayIso();
  const browseRooms = useMemo(() => {
    return rooms.map((room) => ({
      id: room.id,
      name: room.name,
      what: room.what,
      categoryIds: roomCategoryIds(room),
      nextGathering: nextGatheringOn(room.id, cards, today),
      pinOrder: room.pinOrder ?? null,
      joined: room.joined === true,
      ...(room.audience ? { audience: room.audience } : {}),
    }));
  }, [rooms, cards, today]);
  const sections = groupBrowseRooms(categories, browseRooms, focusSlug);
  const parked = hiddenRooms(browseRooms, { admin, stewardRooms });
  const yours = orderBrowseRooms(browseRooms.filter((room) => room.joined));
  const known = focusSlug ? categoryListed(focusSlug, categories, admin || steward) : true;
  const focus = focusSlug
    ? categories.find((category) => category.slug === focusSlug)
    : undefined;
  const showParked =
    (admin || steward) && (focusSlug === null || focusSlug === UNCATEGORIZED_SLUG);
  const showSections = focusSlug !== UNCATEGORIZED_SLUG;
  const canEdit = (roomId: string) =>
    admin || stewardRooms.includes(roomId) || (steward && !remote);

  return (
    <div className="flex flex-col gap-6">
      {focus && known ? (
        <CategoryMast category={focus} />
      ) : (
        <section
          className={focusSlug ? "flex flex-col gap-2" : "plate plate--hero pc-head flex flex-col gap-2"}
        >
          <h1 className="font-display text-4xl text-balance text-fg lg:text-5xl">Find your room</h1>
          <p className="max-w-prose text-base text-muted">A room can be listed in more than one category.</p>
        </section>
      )}

      <nav
        aria-label="Categories"
        className="room-chips sticky z-10 flex gap-2 overflow-x-auto bg-bg py-2 lg:hidden"
      >
        <CategoryChips categories={browseCategories(categories, false)} focusSlug={focusSlug} />
      </nav>

      <div className="room-browse">
        <nav
          aria-label="Categories"
          className="sticky top-[calc(var(--mast-h)+1rem)] hidden w-[14rem] shrink-0 flex-col gap-1 self-start lg:flex"
        >
          <CategoryLinks categories={browseCategories(categories, false)} focusSlug={focusSlug} />
        </nav>
        <div className="room-column flex min-w-0 flex-col gap-8">
          {focusSlug && !known ? (
            <p className="text-sm text-muted" role="status">
              That category is not listed.
            </p>
          ) : null}
          {focusSlug === null ? (
            <section id="your-rooms" className="flex flex-col gap-3">
              <h2 className="font-display text-2xl text-fg">Your rooms</h2>
              {yours.length === 0 ? null : <RoomGrid rooms={yours} onOpen={setRoom} />}
            </section>
          ) : null}
          {showSections
            ? sections.map((section) => (
                <CategorySection
                  key={section.category.slug}
                  category={section.category}
                  rooms={section.rooms}
                  headed={focusSlug === null}
                  onOpen={setRoom}
                />
              ))
            : null}
          {showParked && parked.length > 0 ? (
            <section id="category-uncategorized" className="flex flex-col gap-3">
              <h2 className="font-display text-2xl text-fg">Uncategorized</h2>
              <p className="text-sm text-muted">Rooms waiting for a category.</p>
              <div className="flex flex-col gap-4">
                {parked.map((room) => (
                  <div key={room.id} className="flex flex-col gap-3">
                    <RoomCard room={room} onOpen={setRoom} />
                    {canEdit(room.id) ? (
                      <MoveRoom
                        roomId={room.id}
                        categoryIds={room.categoryIds}
                        categories={categories}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {admin && remote ? <CategoryEditor categories={categories} /> : null}
        </div>
      </div>
    </div>
  );
}

/** No band: the Rooms plate behind the page already carries it (Design audit, 7a169a5). */
function CategoryMast({ category }: { category: RoomCategory }) {
  return (
    <div>
      <section className="plate plate--hero pc-head flex flex-col gap-2">
        <h1 className="font-display text-4xl text-balance text-fg lg:text-5xl">{category.name}</h1>
        <p className="max-w-prose text-sm text-muted">{category.description}</p>
      </section>
    </div>
  );
}

function CategoryChips({
  categories,
  focusSlug,
}: {
  categories: RoomCategory[];
  focusSlug: string | null;
}) {
  return (
    <>
      <Link
        to="/rooms"
        aria-current={focusSlug ? undefined : "page"}
        className={pill(!focusSlug)}
      >
        All
      </Link>
      {categories.map((category) => (
        <Link
          key={category.slug}
          to="/rooms/$slug"
          params={{ slug: category.slug }}
          aria-current={category.slug === focusSlug ? "page" : undefined}
          className={pill(category.slug === focusSlug)}
        >
          {category.name}
        </Link>
      ))}
    </>
  );
}

function CategoryLinks({
  categories,
  focusSlug,
}: {
  categories: RoomCategory[];
  focusSlug: string | null;
}) {
  return (
    <>
      <Link to="/rooms" hash="your-rooms" className={pill(false, "justify-start")}>
        Your rooms
      </Link>
      <Link
        to="/rooms"
        aria-current={focusSlug ? undefined : "page"}
        className={pill(!focusSlug, "justify-start")}
      >
        All rooms
      </Link>
      {categories.map((category) => (
        <Link
          key={category.slug}
          to="/rooms/$slug"
          params={{ slug: category.slug }}
          aria-current={category.slug === focusSlug ? "page" : undefined}
          className={pill(category.slug === focusSlug, "justify-start")}
        >
          {category.name}
        </Link>
      ))}
    </>
  );
}

function CategorySection({
  category,
  rooms,
  headed,
  onOpen,
}: {
  category: RoomCategory;
  rooms: BrowseRoom[];
  headed: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <section id={`category-${category.slug}`} className="flex flex-col gap-3">
      {headed ? (
        <div>
          <h2 className="font-display text-2xl text-fg">{category.name}</h2>
          <p className="text-sm text-muted">{category.description}</p>
        </div>
      ) : null}
      {rooms.length === 0 ? (
        <p className="text-sm text-muted">No rooms here yet. Ask a steward to open one.</p>
      ) : (
        <RoomGrid rooms={rooms} onOpen={onOpen} />
      )}
    </section>
  );
}

function RoomGrid({ rooms, onOpen }: { rooms: BrowseRoom[]; onOpen: (id: string) => void }) {
  return (
    <div className="room-grid">
      {rooms.map((room) => (
        <RoomCard key={room.id} room={room} onOpen={onOpen} />
      ))}
    </div>
  );
}

function RoomCard({ room, onOpen }: { room: BrowseRoom; onOpen: (id: string) => void }) {
  const meets = meetsLabel(room.nextGathering);
  const audience = audienceLabel(room.audience);
  const labels = categoryNames(room.categoryIds);
  return (
    <button type="button" className="room-card" onClick={() => onOpen(room.id)}>
      <span className="room-card-top">
        <span className="room-card-name">{room.name}</span>
        {room.joined ? <span className="room-joined-dot" role="img" aria-label="Joined" /> : null}
      </span>
      {labels ? <span className="room-card-meta">{labels}</span> : null}
      {audience ? <span className="room-card-meta">{audience}</span> : null}
      <span className="room-card-what">{room.what}</span>
      {meets ? <span className="room-card-meta">{meets}</span> : null}
    </button>
  );
}

function CategoryChecks({
  categories,
  selected,
  onChange,
}: {
  categories: RoomCategory[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm text-muted">Categories</legend>
      {categories.map((category) => {
        const checked = selected.includes(category.slug);
        return (
          <label key={category.slug} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              className="size-5"
              checked={checked}
              onChange={() => {
                onChange(
                  checked
                    ? selected.filter((slug) => slug !== category.slug)
                    : [...selected, category.slug],
                );
              }}
            />
            {category.name}
          </label>
        );
      })}
    </fieldset>
  );
}

function MoveRoom({
  roomId,
  categoryIds,
  categories,
}: {
  roomId: string;
  categoryIds: string[];
  categories: RoomCategory[];
}) {
  const updateRoom = useBoard((state) => state.updateRoom);
  const [next, setNext] = useState(categoryIds);
  const [error, setError] = useState("");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        if (next.length === 0) {
          setError("Choose a category.");
          return;
        }
        void updateRoom({ id: roomId, categoryIds: next }).then((result) => {
          if (!result.ok) setError(result.error ?? "The room was not saved.");
        });
      }}
    >
      <CategoryChecks categories={categories} selected={next} onChange={setNext} />
      <button type="submit" className={btnGhost}>
        Save category
      </button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function CategoryEditor({ categories }: { categories: RoomCategory[] }) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { name: string; sortOrder: string }>>({});

  const draftFor = (category: RoomCategory) =>
    drafts[category.slug] ?? { name: category.name, sortOrder: String(category.sortOrder) };

  const markSaved = () => {
    setDrafts({});
    setNotice("Saved.");
    reloadCategories();
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-2xl text-fg">Categories</h2>
      <p className="max-w-prose text-sm text-muted">
        Category is where a room is listed. Who may enter is set by the room&apos;s audience.
      </p>
      <ul className="flex flex-col gap-3">
        {categories.map((category) => {
          const draft = draftFor(category);
          return (
            <li key={category.slug} className="flex flex-col gap-2 border-b border-line pb-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem]">
                <label className="flex flex-col gap-1 text-sm text-muted">
                  Name
                  <input
                    className={fieldClass}
                    value={draft.name}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [category.slug]: { ...draft, name: event.target.value },
                      }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-muted">
                  Order
                  <input
                    className={fieldClass}
                    inputMode="numeric"
                    value={draft.sortOrder}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [category.slug]: { ...draft, sortOrder: event.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => {
                    setError("");
                    setNotice("");
                    const sortOrder = Number(draft.sortOrder);
                    if (!Number.isInteger(sortOrder)) {
                      setError("Give the category a place in the list.");
                      return;
                    }
                    void getBoardClient().then(async (client) => {
                      const result = await client.updateCategory(category.slug, {
                        name: draft.name,
                        sortOrder,
                      });
                      if (!result.ok) {
                        setError(result.error);
                        return;
                      }
                      markSaved();
                    });
                  }}
                >
                  Save {category.name}
                </button>
                {category.slug === UNCATEGORIZED_SLUG ? null : (
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => {
                      setError("");
                      setNotice("");
                      void getBoardClient().then(async (client) => {
                        const removed = await client.deleteCategory(category.slug);
                        if (!removed.ok) {
                          setError(removed.error);
                          return;
                        }
                        markSaved();
                      });
                    }}
                  >
                    Remove {category.name}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setNotice("");
          void getBoardClient().then(async (client) => {
            const result = await client.createCategory({ slug, name });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setSlug("");
            setName("");
            markSaved();
          });
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-muted">
          New slug
          <input
            className={fieldClass}
            value={slug}
            required
            onChange={(event) => setSlug(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          New name
          <input
            className={fieldClass}
            value={name}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="submit" className={btnSignal}>
          Add category
        </button>
      </form>
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

export function RoomCategoryFields({ room }: { room: Room }) {
  const admin = useBoard((state) => state.admin);
  const steward = useBoard((state) => state.steward);
  const remote = useBoard((state) => state.remote);
  const stewardRooms = useBoard((state) => state.stewardRooms);
  const updateRoom = useBoard((state) => state.updateRoom);
  const categories = useCategories();
  const [categoryIds, setCategoryIds] = useState(roomCategoryIds(room));
  const [name, setName] = useState(room.name);
  const [what, setWhat] = useState(room.what);
  const [pin, setPin] = useState(room.pinOrder == null ? "" : String(room.pinOrder));
  const [options, setOptions] = useState<RoomOption[]>([
    ...(room.options ?? DEFAULT_ROOM_OPTIONS),
  ]);
  const [error, setError] = useState("");
  const canEdit = admin || stewardRooms.includes(room.id) || (steward && !remote);
  if (!canEdit) return null;
  return (
    <form
      className="mt-2 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        if (categoryIds.length === 0) {
          setError("Choose a category.");
          return;
        }
        const trimmed = pin.trim();
        const pinOrder = trimmed === "" ? null : Number(trimmed);
        if (trimmed !== "" && !Number.isInteger(pinOrder)) {
          setError("Give the pin a place in the list.");
          return;
        }
        void updateRoom({
          id: room.id,
          categoryIds,
          pinOrder,
          ...(admin ? { name, what, options } : {}),
        }).then((result) => {
          if (!result.ok) setError(result.error ?? "The room was not saved.");
        });
      }}
    >
      {admin ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-muted">
            Name
            <input
              className={fieldClass}
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted sm:col-span-2">
            What it is for
            <input
              className={fieldClass}
              value={what}
              required
              onChange={(event) => setWhat(event.target.value)}
            />
          </label>
        </div>
      ) : null}
      <CategoryChecks
        categories={categories}
        selected={categoryIds}
        onChange={setCategoryIds}
      />
      <p className="max-w-prose text-sm text-muted">
        Category is where a room is listed. Who may enter is set by the room&apos;s audience.
      </p>
      <label className="flex flex-col gap-1 text-sm text-muted">
        Pin order
        <input
          className={fieldClass}
          inputMode="numeric"
          value={pin}
          aria-label="Pin order"
          placeholder="Blank leaves it alphabetical"
          onChange={(event) => setPin(event.target.value)}
        />
      </label>
      {admin ? <RoomOptionsMenu selected={options} onChange={setOptions} /> : null}
      <button type="submit" className={btnGhost}>
        Save room
      </button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
