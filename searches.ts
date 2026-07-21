import type { Search } from "./types.ts";
import { search } from "./njuskalo.ts";

const searches: Search[] = [
  // --- Apartments for sale -------------------------------------------------
  // Njuskalo filters these server-side, so each search is just a set of filters.
  // Every line below is one filter — edit any of them freely. The keys and enum
  // values ("three-rooms", "flat-in-residential-building") are exactly what shows
  // up in the browser URL when you set that filter on the site, so anything the
  // site offers is adjustable here. Copy a whole block to add another city.
  search("Zagreb 4S+ / 70m2+ / <=400k / parking", "/prodaja-stanova", {
    "geo[locationIds]": [
      1261, 2634, 2649, 2651, 2664, 2668, 2672, 2674, 2675, 2676, 13739, 2703,
      2705, 13740, 2716, 2719, 2819, 2821, 2659, 2667, 2669, 2662, 2663, 2660,
      2707, 12934, 2726, 2733, 2817, 2822, 2820, 2816,
    ],
    "price[max]": 400_000,
    "livingArea[min]": 70,
    "numberOfRooms[min]": "three-rooms",
    flatBuildingType: "flat-in-residential-building",
  }),

  // Another city, cheaper, no parking requirement. Get a city's locations by
  // setting them on njuskalo.hr, copying the URL, and wrapping it with
  // locationIds(...) — add that to the import above when you uncomment this:
  //   import { search, locationIds } from "./njuskalo.ts";
  // search("Split 2S+ / 60m2+ / <=280k", "/prodaja-stanova", {
  //   "geo[locationIds]": locationIds(
  //     "https://www.njuskalo.hr/prodaja-stanova?geo%5BlocationIds%5D=...paste...",
  //   ),
  //   "price[max]": 280_000,
  //   "livingArea[min]": 60,
  //   "numberOfRooms[min]": "two-rooms",
  // }),
];

export default searches;
