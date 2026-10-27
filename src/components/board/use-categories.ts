import { useEffect, useState } from "react";
import { getBoardClient } from "@/lib/board/client";
import { CATEGORY_LIST, type RoomCategory } from "@/lib/board/categories";
import { useBoard } from "@/lib/board/store";

const listeners = new Set<() => void>();

/** Ask every open category list to read the server again. */
export function reloadCategories() {
  for (const listener of listeners) listener();
}

/** The seed list in the demo. The server list when signed in. */
export function useCategories(): RoomCategory[] {
  const remote = useBoard((state) => state.remote);
  const steward = useBoard((state) => state.steward);
  const [categories, setCategories] = useState<RoomCategory[]>([...CATEGORY_LIST]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  useEffect(() => {
    if (!remote) {
      setCategories([...CATEGORY_LIST]);
      return;
    }
    let cancel = false;
    void getBoardClient().then(async (client) => {
      const listed = await client.listCategories();
      if (!cancel && listed.ok) setCategories(listed.categories);
    });
    return () => {
      cancel = true;
    };
  }, [remote, steward, tick]);

  return categories;
}
