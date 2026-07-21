# njuskalo-watch

Polls Njuskalo search pages and sends a Telegram alert when a new ad matches.
Runs on a GitHub Actions cron. Single purpose, no framework.

## Conventions

- All code, comments, identifiers and documentation in English. No exceptions.
- TypeScript, ESM, run directly through `tsx`. No build step.
- Dependencies stay minimal and justified: cheerio to parse, playwright to
  fetch (the site needs a real browser to clear its bot challenge).
- A search is either a pasted `{ name, url }` or, for filter-heavy categories,
  `search(name, path, filters)` from `njuskalo.ts`. Filter keys are Njuskalo's
  own URL params (`"price[max]"`, `"geo[locationIds]"`, ...), copied from the
  browser, so every filter the site offers is adjustable without new code.

## Layout

| file | role |
|---|---|
| `watch.ts` | engine: render (headless browser), parse, filter, notify, state |
| `types.ts` | `Search` and `Listing` types |
| `njuskalo.ts` | builds search URLs from filter objects; `search()`, `locationIds()` |
| `searches.ts` | user config, the only file edited regularly |
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

**Cross-sell rails are not results.** Every category page carries side rails
Njuskalo injects itself — "Posljednji oglasi" (latest ads) and "Super Vau
oglasi". Their ads are off-category (a page of phones lists a Lego set) and
rotate completely on every load, so scraping them would seed nothing and fire a
fresh false alert every run. `parseListings` drops anchors inside
`content-supplementary`/`highlightedContentAside`. Yes, this keys on class
names, against the rule above — but it only ever *removes* known chrome, so if
those classes change the rails merely reappear, they never break the parser.

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
