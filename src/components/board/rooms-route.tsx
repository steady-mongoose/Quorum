import { createContext, useContext, type ReactNode } from "react";

/** Null when the address is not /rooms. slug is null on /rooms itself. */
export type RoomsRoute = { slug: string | null };

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
