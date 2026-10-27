import { useEffect, useId, useRef, useState } from "react";
import { btnGhost, btnSignal, fieldClass } from "@/components/quorum/bits";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { reloadCategories, useCategories } from "@/components/board/use-categories";
import { CATEGORY_LIST, UNCATEGORIZED_SLUG } from "@/lib/board/categories";
import { cn } from "@/lib/cn";
import {
  categoryLabel,
  filterRooms,
  groupRooms,
  loadAdminRooms,
  moveSummary,
  searchSummary,
  saveRoomCategories,
  type AdminRoom,
} from "@/lib/board/rooms-admin";

const AUDIENCE: Record<AdminRoom["audience"], string> = {
  all: "Everyone",
  men: "Men",
  women: "Women",
};

const chip = "inline-flex items-center rounded-full border border-line px-3 py-1 text-xs text-fg";

/**
 * Admin-only. Every room, grouped by category, with "Not yet sorted" last.
 * Categories edits where a room is listed. Archive and delete wait on migration 0039.
 */
export function RoomsManager() {
  const categories = useCategories();
  const choices = (categories.length > 0 ? categories : [...CATEGORY_LIST]).filter(
    (category) => category.slug !== UNCATEGORIZED_SLUG,
  );
  const [rooms, setRooms] = useState<AdminRoom[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const moveButtons = useRef(new Map<string, HTMLButtonElement>());
  const firstBox = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const hintId = useId();

  useEffect(() => {
    let live = true;
    void loadAdminRooms().then((result) => {
      if (!live) return;
      if (result.ok) setRooms(result.rooms);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (editing) firstBox.current?.focus();
  }, [editing]);

  // editing is "<group slug>:<room id>", so a room listed twice opens where it was clicked.
  const editingRoomId = editing ? editing.slice(editing.indexOf(":") + 1) : null;
  const editingRoom = rooms?.find((room) => room.id === editingRoomId) ?? null;

  function closeEditor(key: string | null) {
    setEditing(null);
    setConfirming(false);
    if (key) requestAnimationFrame(() => moveButtons.current.get(key)?.focus());
  }

  function startMove(room: AdminRoom, key: string) {
    setNote("");
    setError("");
    setPicked(room.categoryIds.filter((slug) => slug !== UNCATEGORIZED_SLUG));
    setEditing(key);
  }

  async function confirmMove() {
    if (!editingRoom) return;
    setSaving(true);
    const result = await saveRoomCategories(editingRoom.id, picked);
    setSaving(false);
    if (!result.ok) {
      setConfirming(false);
      setError(result.error);
      return;
    }
    setRooms((current) =>
      (current ?? []).map((room) => (room.id === result.room.id ? result.room : room)),
    );
    setNote(`${result.room.name}'s categories saved.`);
    reloadCategories();
    closeEditor(editing);
  }

  const matches = rooms ? filterRooms(rooms, query) : [];
  const groups = rooms ? groupRooms(matches, categories) : [];

  return (
    <section
      aria-labelledby="rooms-manager-heading"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-5 lg:max-w-3xl"
    >
      <h2 id="rooms-manager-heading" className="text-2xl text-fg">
        Rooms
      </h2>
      <p className="max-w-prose text-sm text-muted">
        Every room, by category. Check each room is in the right place. Move changes where members
        find it. A room can be in more than one category.
      </p>
      <label htmlFor={searchId} className="flex flex-col gap-2 text-sm text-muted">
        Find a room
        <input
          id={searchId}
          type="search"
          className={cn(fieldClass, "min-h-[44px]")}
          value={query}
          placeholder="Name or slug"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p role="status" aria-live="polite" className="text-sm text-muted">
        {rooms === null ? "" : searchSummary(matches.length)}
      </p>
      <p role="status" className="text-sm text-fg">
        {note}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {rooms === null && !error ? <p className="text-sm text-muted">Loading rooms…</p> : null}

      {groups.map((group) => (
        <div key={group.slug} className="flex flex-col gap-2">
          <h3 className="text-lg text-fg">
            {group.name} ({group.rooms.length})
          </h3>
          <ul className="flex flex-col gap-2">
            {group.rooms.map((room) => {
              const key = `${group.slug}:${room.id}`;
              const open = editing === key;
              return (
                <li key={room.id} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-base text-fg">{room.name}</span>
                      <span className="text-sm text-muted">
                        {AUDIENCE[room.audience]} ·{" "}
                        {room.stewards.length > 0 ? (
                          `Stewards: ${room.stewards.join(", ")}`
                        ) : (
                          <strong className="font-semibold text-danger">No steward yet</strong>
                        )}
                      </span>
                      <ul aria-label="Categories" className="flex flex-wrap gap-2">
                        {(room.categoryIds.length > 0
                          ? room.categoryIds
                          : [UNCATEGORIZED_SLUG]
                        ).map((slug) => (
                          <li key={slug} className={chip}>
                            {categoryLabel(slug, categories)}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <button
                      type="button"
                      ref={(node) => {
                        if (node) moveButtons.current.set(key, node);
                      }}
                      className={cn(btnGhost, "min-h-[44px]")}
                      aria-expanded={open}
                      aria-label={`Change categories for ${room.name}`}
                      onClick={() => (open ? closeEditor(key) : startMove(room, key))}
                    >
                      Categories
                    </button>
                  </div>
                  {open ? (
                    <fieldset className="mt-3 flex flex-col gap-2">
                      <legend className="text-sm text-fg">
                        Where should members find {room.name}?
                      </legend>
                      {choices.map((category, index) => (
                        <label
                          key={category.slug}
                          className="flex min-h-[44px] items-center gap-3 text-sm text-fg"
                        >
                          <input
                            ref={index === 0 ? firstBox : undefined}
                            type="checkbox"
                            className="h-5 w-5"
                            checked={picked.includes(category.slug)}
                            onChange={(event) =>
                              setPicked((current) =>
                                event.target.checked
                                  ? [...current, category.slug]
                                  : current.filter((slug) => slug !== category.slug),
                              )
                            }
                          />
                          {category.name}
                        </label>
                      ))}
                      {picked.length === 0 ? (
                        <p id={hintId} className="text-sm text-muted">
                          Choose at least one category.
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={cn(btnSignal, "min-h-[44px]")}
                          aria-disabled={picked.length === 0 || undefined}
                          aria-describedby={picked.length === 0 ? hintId : undefined}
                          onClick={() => {
                            if (picked.length === 0) return;
                            setConfirming(true);
                          }}
                        >
                          Save categories
                        </button>
                        <button
                          type="button"
                          className={cn(btnGhost, "min-h-[44px]")}
                          onClick={() => closeEditor(key)}
                        >
                          Cancel
                        </button>
                      </div>
                    </fieldset>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <p className="max-w-prose text-sm text-muted">Archive and delete are coming soon.</p>

      <ConfirmDialog
        open={confirming && editingRoom !== null}
        tone="neutral"
        title={editingRoom ? `Change where ${editingRoom.name} is listed?` : ""}
        description={
          editingRoom
            ? moveSummary(
                editingRoom,
                editingRoom.categoryIds.filter((slug) => slug !== UNCATEGORIZED_SLUG),
                picked,
                categories,
              )
            : ""
        }
        confirmLabel={saving ? "Saving…" : "Save"}
        cancelLabel="Cancel"
        confirmDisabled={saving}
        onConfirm={() => void confirmMove()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
