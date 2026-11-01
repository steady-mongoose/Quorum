import { useRoomsRoute } from "@/components/board/rooms-route";
import { currentCounty, type CountyId } from "@/lib/board/counties";
import { useBoard } from "@/lib/board/store";

/** The county on screen. On a rooms page, the address decides. */
export function useCounty(): CountyId {
  const route = useRoomsRoute();
  const chosen = useBoard((state) => state.county);
  const homeCounty = useBoard((state) => state.homeCounty);
  return currentCounty({ routeCounty: route?.county, chosen, homeCounty });
}
