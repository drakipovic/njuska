import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSearches } from "../watch.ts";

test("parseSearches reads {searches:[...]} and drops disabled / url-less rows", () => {
  const out = parseSearches({
    searches: [
      { name: "A", url: "https://x/a", enabled: true },
      { name: "B", url: "https://x/b", enabled: false },
      { name: "C" }, // no url
      { name: "D", url: "https://x/d", none: ["zamjena"] },
    ],
  });
  assert.deepEqual(out.map((s) => s.name), ["A", "D"]);
  assert.deepEqual(out[1].none, ["zamjena"]);
});

test("parseSearches accepts a bare array and defaults a missing name to the url", () => {
  const out = parseSearches([{ url: "https://x/a" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "https://x/a");
});

test("parseSearches tolerates junk without throwing", () => {
  assert.deepEqual(parseSearches(null), []);
  assert.deepEqual(parseSearches({}), []);
  assert.deepEqual(parseSearches({ searches: "nope" as unknown as [] }), []);
});
