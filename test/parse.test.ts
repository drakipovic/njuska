import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseListings, parsePrice, withPage } from "../watch.ts";

const EUR = "€"; // the currency suffix, kept in one place
const fixture = await readFile(new URL("./fixture.html", import.meta.url), "utf8");
const listings = parseListings(fixture);
const byId = new Map(listings.map((l) => [l.id, l]));

// The fixture is a real capture of https://www.njuskalo.hr/mobiteli?sort=new
// (see README / test/fixture.html). It contains 40 in-category results plus the
// two cross-sell rails Njuskalo injects, which must NOT be parsed as results.

test("parses every in-category result and nothing from the cross-sell rails", () => {
  assert.equal(listings.length, 40);
});

test("the 'Posljednji oglasi' (latest ads) rail is excluded", () => {
  // These ids are the site-wide latest-ads rail: a Lego set, a dictionary, an
  // Austro-Hungarian cap, a car sensor -- none of them phones, all off-category.
  for (const id of ["51035214", "51035215", "51035216", "51035217", "51035218", "51035219"]) {
    assert.ok(!byId.has(id), `rail ad ${id} leaked into results`);
  }
});

test("title is the real ad title, not a category or seller name", () => {
  const l = byId.get("50394830");
  assert.ok(l, "expected featured-store ad 50394830");
  assert.ok(l.title.includes("XIAOMI REDMI NOTE 14 PRO+"), `unexpected title: ${l.title}`);
  // No parsed listing should have an empty title.
  assert.ok(listings.every((x) => x.title.length > 0));
});

test("priceText matches what is rendered and the number parses", () => {
  const cents = byId.get("32998845");
  assert.equal(cents?.priceText, `6,99 ${EUR}`);
  assert.equal(cents?.price, 6.99);

  const thousands = byId.get("48327791");
  assert.equal(thousands?.priceText, `1.290 ${EUR}`);
  assert.equal(thousands?.price, 1290);
});

test("promoted placements that render no price stay null, not a wrong guess", () => {
  // Featured-store / SuperVau cards carry no price element in list view.
  const l = byId.get("50394830");
  assert.equal(l?.price, null);
  assert.equal(l?.priceText, null);
});

test("parsePrice handles Croatian thousands + cents", () => {
  assert.equal(parsePrice(`1.250,00 ${EUR}`), 1250);
  assert.equal(parsePrice(`450 ${EUR}`), 450);
  assert.equal(parsePrice(`6,99 ${EUR}`), 6.99);
});

// Synthetic cases for formats the live capture happened not to contain, so the
// parser's contract is pinned regardless of what a given fetch returns.
const synthetic = (href: string, priceHtml: string) => `
<ul class="EntityList-items"><li class="EntityList-item EntityList-item--Regular">
<article class="entity-body"><h3 class="entity-title"><a href="${href}"><span>Test ad</span></a></h3>
<div class="entity-prices"><strong class="price price--hrk">${priceHtml}</strong></div>
</article></li></ul>`;

test("a rendered '1.250,00' price is captured verbatim and parses to 1250", () => {
  const [l] = parseListings(synthetic("/x/a-oglas-900001", `1.250,00 ${EUR}`));
  assert.equal(l.priceText, `1.250,00 ${EUR}`);
  assert.equal(l.price, 1250);
});

test("'Po dogovoru' is shown as priceText but leaves the number null", () => {
  const [l] = parseListings(synthetic("/x/b-oglas-900002", "Po dogovoru"));
  assert.equal(l.priceText, "Po dogovoru");
  assert.equal(l.price, null);
});

test("withPage appends ?page= as a query param (Njuskalo's pagination)", () => {
  assert.equal(
    withPage("https://www.njuskalo.hr/mobiteli?sort=new", 2),
    "https://www.njuskalo.hr/mobiteli?sort=new&page=2",
  );
});

// A second real capture, from /prodaja-stanova, so the parser is pinned on a
// different category with six-figure prices, not just phones.
const apartments = parseListings(
  await readFile(new URL("./apartments.html", import.meta.url), "utf8"),
);

test("parses the apartment category and its six-figure prices", () => {
  assert.equal(apartments.length, 35);
  const l = apartments.find((x) => x.id === "50661822");
  assert.equal(l?.priceText, `350.000 ${EUR}`);
  assert.equal(l?.price, 350000);
});
