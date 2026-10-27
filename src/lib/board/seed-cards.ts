// Seed cards from the brief: real places around Brandon and Riverview, each
// still to be visited before it stays.

import { newCard, type MeetingCard, type RoomId } from "./model.ts";

function card(
  id: string,
  room: RoomId,
  name: string,
  place: string,
  time: string,
  extra: Partial<MeetingCard> = {},
): MeetingCard {
  return newCard({ id, room, kind: "meeting", name, place, time, host: "", ...extra });
}

/** Checked once by the brief, still to be visited before they stay. */
const brief = { unverified: true, wentBy: ["brief"] };

export const SEED_CARDS: MeetingCard[] = [
  card(
    "latin-epiphany",
    "latin",
    "Epiphany of Our Lord Shrine",
    "2510 E Hanna Ave, Tampa",
    "Sunday Low Mass 7 and 9, High Mass 11",
    { host: "Institute of Christ the King", ...brief },
  ),
  card(
    "orthodox-stjohn",
    "orthodox",
    "St. John the Baptist",
    "2418 W Swann Ave, Tampa",
    "Confirm in person",
    brief,
  ),
  card(
    "baptist-gbcb",
    "baptist",
    "Grace Bible Church of Brandon",
    "1010 E Brandon Blvd, Brandon · (813) 662-9622",
    "Sunday school 9:00, worship 10:30. Reformed Baptist, 1689.",
    brief,
  ),
  card(
    "presbyterian-redeemer",
    "presbyterian",
    "Redeemer Presbyterian",
    "Boyette Road, Riverview",
    "Confirm in person",
    brief,
  ),
  card(
    "presbyterian-first",
    "presbyterian",
    "First Reformed",
    "W Hillsborough Ave, Tampa",
    "Confirm in person. Confession to confirm too.",
    brief,
  ),
  card(
    "shop-ham",
    "shop",
    "Tampa Amateur Radio Club",
    "7801 N 22nd St, Tampa",
    "First Monday 7:30 p.m. Tuesday net 147.105 at 8 p.m.",
    brief,
  ),
  card(
    "shop-garden",
    "shop",
    "Hillsborough Master Gardener desk",
    "(813) 744-5519 ext. 54102",
    "Office hours",
    brief,
  ),
  card("shelf-stoics", "shelf", "Tampa Stoics", "Tampa", "Confirm in person", brief),
  card(
    "shop-shapes",
    "shop",
    "Shapes, women's gym hour",
    "731 W Lumsden, Brandon",
    "Confirm in person",
    brief,
  ),
];
