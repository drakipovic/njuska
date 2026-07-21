import { test } from "node:test";
import assert from "node:assert/strict";
import { njuskaloUrl, search, locationIds } from "../njuskalo.ts";

test("njuskaloUrl encodes bracketed params and comma-joins lists like the browser", () => {
  const url = njuskaloUrl("/prodaja-stanova", {
    "geo[locationIds]": [1261, 2634, 2649],
    "price[max]": 350_000,
    "numberOfRooms[min]": "three-rooms",
  });
  assert.ok(url.startsWith("https://www.njuskalo.hr/prodaja-stanova?"));
  assert.ok(url.includes("geo%5BlocationIds%5D=1261%2C2634%2C2649"), url);
  assert.ok(url.includes("price%5Bmax%5D=350000"), url);
  assert.ok(url.includes("numberOfRooms%5Bmin%5D=three-rooms"), url);
});

test("njuskaloUrl adds sort=new by default but never overrides an explicit sort", () => {
  assert.ok(njuskaloUrl("/prodaja-stanova", {}).endsWith("sort=new"));
  const custom = njuskaloUrl("/prodaja-stanova", { sort: "price_asc" });
  assert.ok(custom.includes("sort=price_asc"));
  assert.ok(!custom.includes("sort=new"));
});

test("njuskaloUrl accepts a full URL as the path", () => {
  const url = njuskaloUrl("https://www.njuskalo.hr/mobiteli", { "price[max]": 600 });
  assert.ok(url.startsWith("https://www.njuskalo.hr/mobiteli?"));
  assert.ok(url.includes("price%5Bmax%5D=600"));
});

test("search() returns a named Search and passes title filters through", () => {
  const s = search("Test", "/prodaja-stanova", { "price[max]": 100 }, { pages: 2 });
  assert.equal(s.name, "Test");
  assert.equal(s.pages, 2);
  assert.ok(s.url.includes("price%5Bmax%5D=100"));
});

test("locationIds extracts the ids from a pasted browser URL", () => {
  const pasted =
    "https://www.njuskalo.hr/prodaja-stanova?geo%5BlocationIds%5D=1261%2C2634%2C2649&price%5Bmax%5D=350000";
  assert.deepEqual(locationIds(pasted), [1261, 2634, 2649]);
  assert.deepEqual(locationIds("https://www.njuskalo.hr/prodaja-stanova"), []);
});
