import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { btnGhost, btnSignal, fieldClass, Kicker, pill } from "@/components/quorum/bits";
import { getBoardClient } from "@/lib/board/client";
import {
  UNCATEGORIZED_SLUG,
  browseCategories,
  categoryListed,
  groupBrowseRooms,
  hiddenRooms,
  nextGatheringOn,
  roomCategoryId,
  type BrowseRoom,
  type RoomCategory,
} from "@/lib/board/categories";
import { formatDate, todayIso, type Room } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { reloadCategories, useCategories } from "@/components/board/use-categories";

/**
 * Rooms by category. Phone: a sticky chip row, then plate sections.
 * Desktop: a 14rem sticky list beside a two- or three-column grid.
 * /rooms/<slug> is the shareable page for one category. Members only.
 */
export function RoomBrowse({ focusSlug }: { focusSlug: string | null }) {
  const rooms = useBoard((state) => state.rooms);
  const cards = useBoard((state) => state.cards);
  const steward = useBoard((state) => state.steward);
  const remote = useBoard((state) => state.remote);
  const setRoom = useBoard((state) => state.setRoom);
  const categories = useCategories();
  const today = todayIso();
  const browseRooms = useMemo(() => {
    return rooms.map((room) => ({
      id: room.id,
      name: room.name,
      what: room.what,
      categoryId: roomCategoryId(room),
      nextGathering: nextGatheringOn(room.id, cards, today),
    }));
  }, [rooms, cards, today]);
  const sections = groupBrowseRooms(categories, browseRooms, focusSlug);
  const parked = hiddenRooms(browseRooms, steward);
  const known = focusSlug ? categoryListed(focusSlug, categories, steward) : true;
  const showParked = steward && (focusSlug === null || focusSlug === UNCATEGORIZED_SLUG);
  const showSections = focusSlug !== UNCATEGORIZED_SLUG;

  return (
    <div className="flex flex-col gap-6">
      <section className="plate flex flex-col gap-2">
        <Kicker>Rooms</Kicker>
        <h1 className="illum font-display text-4xl text-balance text-fg lg:text-5xl">Rooms</h1>
        <p className="max-w-prose text-base text-muted">
          One category for each room. A room with a gathering comes first. The rest are
          alphabetical.
        </p>
      </section>

      <nav
        aria-label="Categories"
        className="sticky top-32 z-10 flex gap-2 overflow-x-auto bg-bg py-2 lg:hidden"
      >
        <CategoryChips categories={browseCategories(categories, false)} focusSlug={focusSlug} />
      </nav>

      <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <nav
          aria-label="Categories"
          className="sticky top-28 hidden w-[14rem] shrink-0 flex-col gap-1 self-start lg:flex"
        >
          <CategoryLinks categories={browseCategories(categories, false)} focusSlug={focusSlug} />
        </nav>
        <div className="flex min-w-0 flex-col gap-8">
          {focusSlug && !known ? (
            <p className="text-sm text-muted" role="status">
              That category is not listed.
            </p>
          ) : null}
          {showSections
            ? sections.map((section) => (
                <CategorySection
                  key={section.category.slug}
                  category={section.category}
                  rooms={section.rooms}
                  onOpen={setRoom}
                />
              ))
            : null}
          {showParked && parked.length > 0 ? (
            <section id="category-uncategorized" className="flex flex-col gap-3">
              <h2 className="font-display text-2xl text-fg">Uncategorized</h2>
              <p className="max-w-prose text-sm text-muted">
                Hidden from Browse until you give each room a category.
              </p>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {parked.map((room) => (
                  <article key={room.id} className="plate flex flex-col gap-3">
                    <RoomCard room={room} onOpen={setRoom} />
                    <MoveRoom
                      roomId={room.id}
                      categoryId={room.categoryId}
                      categories={categories}
                    />
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {steward && remote ? <CategoryEditor categories={categories} /> : null}
        </div>
      </div>
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
  if (focusSlug) {
    return (
      <>
        <Link to="/rooms/" className={pill(false)}>
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
  return (
    <>
      {categories.map((category) => (
        <a key={category.slug} href={`#category-${category.slug}`} className={pill(false)}>
          {category.name}
        </a>
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
      <Link
        to="/rooms/"
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
  onOpen,
}: {
  category: RoomCategory;
  rooms: BrowseRoom[];
  onOpen: (id: string) => void;
}) {
  return (
    <section id={`category-${category.slug}`} className="flex flex-col gap-3">
      <h2 className="font-display text-2xl text-fg">{category.name}</h2>
      {rooms.length === 0 ? (
        <p className="text-sm text-muted">Nothing in this category yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

function RoomCard({ room, onOpen }: { room: BrowseRoom; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      className="plate flex min-h-[44px] flex-col gap-2 text-left"
      onClick={() => onOpen(room.id)}
    >
      <span className="font-display text-2xl text-fg">{room.name}</span>
      <span className="text-sm text-muted">{room.what}</span>
      {room.nextGathering ? (
        <span className="text-sm text-muted">Next gathering {formatDate(room.nextGathering)}</span>
      ) : null}
    </button>
  );
}

function MoveRoom({
  roomId,
  categoryId,
  categories,
}: {
  roomId: string;
  categoryId: string;
  categories: RoomCategory[];
}) {
  const updateRoom = useBoard((state) => state.updateRoom);
  const [next, setNext] = useState(categoryId);
  const [error, setError] = useState("");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        if (!next) {
          setError("Choose a category.");
          return;
        }
        void updateRoom({ id: roomId, categoryId: next }).then((result) => {
          if (!result.ok) setError(result.error ?? "The room was not saved.");
        });
      }}
    >
      <label className="flex flex-col gap-2 text-sm text-muted">
        Category
        <select
          className={fieldClass}
          value={next}
          required
          onChange={(event) => setNext(event.target.value)}
        >
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
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
    <section className="plate flex flex-col gap-4">
      <h2 className="font-display text-2xl text-fg">Categories</h2>
      <p className="max-w-prose text-sm text-muted">
        Stewards edit this list. Men and Women are labels. Who may enter is decided separately.
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
  const updateRoom = useBoard((state) => state.updateRoom);
  const categories = useCategories();
  const [categoryId, setCategoryId] = useState(roomCategoryId(room));
  const [name, setName] = useState(room.name);
  const [what, setWhat] = useState(room.what);
  const [error, setError] = useState("");
  if (!steward) return null;
  return (
    <form
      className="mt-2 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        if (!categoryId) {
          setError("Choose a category.");
          return;
        }
        void updateRoom({
          id: room.id,
          categoryId,
          ...(admin ? { name, what } : {}),
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
      <label className="flex flex-col gap-1 text-sm text-muted">
        Category
        <select
          className={fieldClass}
          value={categoryId}
          required
          aria-label="Category"
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">Choose a category</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
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
