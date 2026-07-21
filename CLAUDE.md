# njuskalo-watch

Polls Njuskalo search pages and sends a Telegram alert when a new ad matches.
Runs on a GitHub Actions cron. Single purpose, no framework.

## Conventions

- All code, comments, identifiers and documentation in English. No exceptions.
- TypeScript, ESM, run directly through `tsx`. No build step.
- Dependencies stay minimal and justified: cheerio to parse, playwright to
  fetch (the site needs a real browser to clear its bot challenge).
- Searches live in `searches.json` (name + a pasted Njuskalo URL per entry), the
  single source of truth the engine reads at runtime. They are edited through the
  web UI in `docs/` (GitHub Pages), which commits the file via the GitHub API — so
  adding a search needs no code change and no manual commit.

## Layout

| file | role |
|---|---|
| `watch.ts` | engine: render (headless browser), parse, filter, notify, state |
| `types.ts` | `Search` and `Listing` types |
| `searches.json` | the searches (name + URL), written by the UI, read by the engine |
| `docs/index.html` | the web UI (GitHub Pages) that edits `searches.json` via the GitHub API |
| `njuskalo.ts` | optional helper to build a Njuskalo URL from a filters object |
| `state/seen.json` | ad IDs already seen, committed by CI |
| `test/fixture.html` | a real `/mobiteli` capture, frozen as the parser fixture |
| `test/apartments.html` | a real `/prodaja-stanova` capture (six-figure prices) |
| `test/*.test.ts` | pin the parser and URL builder against the fixtures |

## Decisions that must not be reverted

**Parse by URL pattern, not CSS classes.** The selector is `a[href*='-oglas-']`
plus the nearest `li`/`article` for price. Njuskalo ad URLs end in
`-oglas-<id>` and have been stable for years; class names change with every
redesign. Do not "improve" this into `.EntityList-item` or similar.

**`PRICE_RE` must not allow whitespace inside the number.** With `\s` in that
character class, a card containing "Samsung Galaxy S21" and "280 €" parses as
21280. Prefer a dedicated `[class*='price']` element, fall back to card text,
and leave the price `null` rather than guess.

**Zero parsed listings is an error, not "nothing new".** It means blocked or
markup changed. It must send a warning and exit non-zero. Silently returning an
empty list is the main way a tool like this dies without anyone noticing.

**Promoted chrome is not results.** Two kinds of injected ads must never be
parsed as results, or they seed nothing and fire false alerts forever:

- The side rails — "Posljednji oglasi" (latest ads) and "Super Vau oglasi".
  Off-category (a page of phones lists a Lego set) and fully rotating each load.
- The "Istaknute trgovine" FeaturedStore carousel — a store's own inventory,
  shown on every search *ignoring the query's filters*. On a 70 m²+/3-room+
  apartment search it still lists 22 m² one-room flats. This one is why filtered
  searches leaked junk.

`parseListings` drops anchors inside `content-supplementary`,
`highlightedContentAside`, or `FeaturedStore`. VauVau and Regular listings do
respect the filters and are kept. Yes, this keys on class names, against the rule
above — but it only ever *removes* known chrome, so if those classes change the
blocks merely reappear, they never break the parser.

**Promoted placements render no price.** SuperVau and FeaturedStore cards carry
no price element in list view, so a null price on those is correct, not a parse
miss. Do not "fix" it by digging harder into the card. A non-numeric price slot
like "Po dogovoru" is surfaced as `priceText` for display but still leaves the
numeric `price` null.

**Never log the Telegram request URL.** The bot token sits in the path.

**The first run for a search seeds silently.** Empty state means record
everything and send nothing, otherwise run one fires fifty alerts.

**Filter patterns are diacritic-folded on both sides** via `fold()`, so
`kuciste` matches `KUĆIŠTE`. Folding lowercases as part of its job; do not layer
case-sensitive logic on top.

**Price filters skip listings with no parsed price** unless `required: true` is
set. A missed find is worse than one extra notification.

## Fetching

Njuskalo is behind Radware's bot manager: a plain HTTP request gets a JS
challenge (a redirect to `validate.perfdrive.com`), so `fetch` alone only ever
captures the block page. `fetchPage` renders each URL in headless Chromium
(Playwright), which runs the challenge and returns the real markup. The CI
workflow installs the browser with `npx playwright install --with-deps chromium`.

Be a decent citizen: one browser per run, reused across pages, keep the pause
between page fetches. No need to crank the cron — Actions minutes are free on a
public repo, but the site isn't.

## Verifying changes

```bash
npm run watch -- --dry
```

Fetches live through the browser and prints every listing with pass/fail and the
rule that rejected it. Sends nothing, writes no state. Run it after any parser
or filter change.

For a fast offline check that never touches the network, run the parser against
the committed fixtures:

```bash
npm test
```

Refresh a fixture only when the markup genuinely changes.
