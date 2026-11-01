import { createContext, useContext, type ReactNode } from "react";

/**
 * Null when the address is not a rooms page. slug is null on the county's rooms
 * page itself. county is null on an old /rooms address, which redirects.
 */
export type RoomsRoute = { slug: string | null; county: string | null };

const RoomsRouteContext = createContext<RoomsRoute | null>(null);

export function RoomsRouteProvider({
  value,
  children,
}: {
  value: RoomsRoute | null;
  children: ReactNode;
}) {
  return <RoomsRouteContext.Provider value={value}>{children}</RoomsRouteContext.Provider>;
}

export function useRoomsRoute(): RoomsRoute | null {
  return useContext(RoomsRouteContext);
}
