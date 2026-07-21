# njuskalo-watch

Polls Njuskalo search pages and sends a Telegram alert when a new ad matches.
Runs on a GitHub Actions cron. Single purpose, no framework.

## Conventions

- All code, comments, identifiers and documentation in English. No exceptions.
- TypeScript, ESM, run directly through `tsx`. No build step.
- Stay dependency-light. Currently cheerio and nothing else.
- A search is either a pasted `{ name, url }` or, for filter-heavy categories,
  `search(name, path, filters)` from `njuskalo.ts`. Filter keys are Njuskalo's
  own URL params (`"price[max]"`, `"geo[locationIds]"`, ...), copied from the
  browser, so every filter the site offers is adjustable without new code.

## Layout

| file | role |
|---|---|
| `watch.ts` | engine: fetch, parse, filter, notify, state |
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

## Constraints

- Do not fetch faster than the cron interval. No proxy rotation, no CAPTCHA
  solving, no anti-bot evasion. If it gets blocked, it gets blocked.
- GitHub Actions runs from Azure IP ranges, so 403s are an expected failure
  mode, not a bug to engineer around.
- On a private repo on the free plan keep the cron at `*/30` or slower. Jobs
  bill rounded up to a whole minute against a 2,000 minute monthly quota.

## Verifying changes

```bash
npm run watch -- --dry
```

Prints every listing found with pass/fail and the rule that rejected it. Sends
nothing, writes no state. Run it after any parser or filter change.

For an offline check that does not depend on the site being reachable (plain
`fetch` is bot-blocked from most IPs, GitHub Actions included), run the parser
against the committed fixture:

```bash
npm test
```

Refresh the fixture with a real browser only when the markup genuinely changes;
`fetch` alone will just capture Njuskalo's bot wall.
