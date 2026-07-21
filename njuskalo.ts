import type { Search } from "./types.ts";

const BASE = "https://www.njuskalo.hr";

/** A filter value: a scalar, or a list Njuskalo joins with commas (e.g. geo[locationIds]). */
export type Filter = string | number | Array<string | number>;

/** One search's filters, keyed by Njuskalo's own param names as they appear in the browser URL. */
export type Filters = Record<string, Filter>;

/**
 * Build a njuskalo.hr search URL from a category path and a filters object. Keys
 * are Njuskalo's own query params, copied straight from the browser URL after you
 * set a filter on the site, e.g.:
 *
 *   "geo[locationIds]"          city / neighbourhood ids (a list)
 *   "price[min]" / "price[max]"
 *   "livingArea[min]"           m2
 *   "numberOfRooms[min]"        e.g. "three-rooms"
 *   "numberOfParkingSpots[min]"
 *   "flatBuildingType"          e.g. "flat-in-residential-building"
 *
 * Any key works, so every filter Njuskalo offers is adjustable — you never have
 * to teach this file about it. Lists are comma-joined and everything is URL
 * encoded for you. `sort=new` is added unless you set your own sort, so the
 * freshest ads land on page 1.
 */
export function njuskaloUrl(path: string, filters: Filters): string {
  const u = new URL(path.startsWith("http") ? path : BASE + path);
  for (const [key, value] of Object.entries(filters)) {
    u.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  if (!u.searchParams.has("sort")) u.searchParams.set("sort", "new");
  return u.toString();
}

/** A named Search from a category path and its filters, plus any title filters via `extra`. */
export function search(
  name: string,
  path: string,
  filters: Filters,
  extra: Partial<Omit<Search, "name" | "url">> = {},
): Search {
  return { name, url: njuskaloUrl(path, filters), ...extra };
}

/**
 * Pull the location ids out of a Njuskalo URL copied from the browser, so adding
 * an area is "select it on the site, copy the URL, paste it here" instead of
 * typing a row of numbers. Returns [] if the URL carries no locations.
 */
export function locationIds(pastedUrl: string): number[] {
  const raw = new URL(pastedUrl).searchParams.get("geo[locationIds]");
  return raw ? raw.split(",").map(Number).filter(Number.isFinite) : [];
}
