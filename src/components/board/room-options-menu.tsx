import {
  LEGACY_ROOM_OPTIONS,
  ROOM_OPTION_LABEL,
  ROOM_OPTION_WHAT,
  type RoomOption,
} from "@/lib/board/room-options";

/**
 * The menu of what a room includes. An admin picks these when setting the room
 * up and can change them later. Roll call starts off.
 */
export function RoomOptionsMenu({
  selected,
  onChange,
  legend = "What this room includes",
}: {
  selected: readonly RoomOption[];
  onChange: (next: RoomOption[]) => void;
  legend?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2 text-sm text-muted">
      <legend className="mb-1 text-fg">{legend}</legend>
      {LEGACY_ROOM_OPTIONS.map((option) => {
        const on = selected.includes(option);
        return (
          <label key={option} className="flex min-h-[44px] items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-5"
              checked={on}
              onChange={() =>
                onChange(
                  LEGACY_ROOM_OPTIONS.filter((item) =>
                    item === option ? !on : selected.includes(item),
                  ),
                )
              }
            />
            <span className="flex flex-col">
              <span className="text-fg">{ROOM_OPTION_LABEL[option]}</span>
              <span>{ROOM_OPTION_WHAT[option]}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
