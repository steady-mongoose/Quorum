import { useEffect } from "react";
import { artAttribute, isEveningHour, type ArtSection, type PlateView } from "@/lib/board/engraved";

/**
 * Puts the section on `<body>` after the first paint, and the evening warmth
 * on `<html>` from the local clock. Reduced data never resolves an art URL.
 */
export function useEngravedDocument(section: ArtSection | null) {
  useEffect(() => {
    const root = document.documentElement;
    if (isEveningHour(new Date().getHours())) root.setAttribute("data-evening", "");
    else root.removeAttribute("data-evening");

    const reducedData = window.matchMedia("(prefers-reduced-data: reduce)").matches;
    let alive = true;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!alive) return;
        const name = artAttribute({ painted: true, reducedData, section });
        if (name) document.body.dataset.section = name;
        else delete document.body.dataset.section;
      });
    });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [section]);
}

/** `<body data-view="room|group">` while a room or a group is open; removed otherwise. */
export function usePlateView(view: PlateView | null) {
  useEffect(() => {
    if (view) document.body.dataset.view = view;
    else delete document.body.dataset.view;
    return () => {
      delete document.body.dataset.view;
    };
  }, [view]);
}
