# njuskalo-watch

Polls Njuskalo searches and sends a Telegram message when something new matches. No server, runs on a GitHub Actions cron.

```
watch.ts                     engine (renders each page in headless Chromium)
types.ts                     Search / Listing types
njuskalo.ts                  builds search URLs from a filters object
searches.ts                  what you hunt  <- the only file you edit regularly
state/seen.json              committed ad IDs (automatic)
.github/workflows/watch.yml  cron
```

Njuskalo is behind a bot wall (Radware), so a plain HTTP request just gets a JS
challenge. The fetch runs a real headless browser (Playwright/Chromium) that
clears the challenge and returns the actual markup.

## Writing filters

Everything lives in `searches.ts`. It's TypeScript, so you get autocomplete and the typechecker catches mistakes before a run.

```ts
{
  name: "iPhone",
  url: "https://www.njuskalo.hr/mobiteli?sort=new",
  all:  [["iphone"], ["iphone 13", "iphone 14"], ["128", "256"]],
  none: ["kuciste", "maskica", "zamjena", "za dijelove", "kupujem"],
  price: { max: 600 },
}
```

Three list fields, each holding **groups**. A group is one pattern or an array of alternatives.

| field | passes when |
|---|---|
| `all` | every group matches (alternatives inside a group are OR) |
| `any` | at least one group matches |
| `none` | no group matches |

So the example above reads: `iphone` AND (`iphone 13` OR `iphone 14`) AND (`128` OR `256`), and none of the junk words.

**Patterns are regex, matched case- and diacritic-insensitively.** `kuciste` matches `KUĆIŠTE`, `zuti` matches `žuti`, `daci` matches `đaci`. Write them however you like; sellers won't be consistent, and this normalises both sides. Regex still works when you need it: `lopta.? stroj`, `\bs21\b`, `(gtx|rtx) ?30[678]0`.

`price` only applies when a price was parsed. Listings with "Po dogovoru" pass through by default, on the theory that a missed find is worse than one extra notification. Set `required: true` to drop them.

For anything the fields can't express, `match` is a plain predicate that runs last:

```ts
match: (l) => !/\bdo \d+ ?kn\b/i.test(l.title) && l.title.length < 80,
```

## Iterating

```bash
npm install
npx playwright install chromium   # one-time: the browser the fetch drives
npm run watch -- --dry
```

This prints every listing found, whether it passed, and **which rule rejected it**:

```
│ Apple iPhone 13 128GB      │ 1.250,00 € │      │ price > 600              │
│ iPhone 13 KUĆIŠTE 128 orig │ 15 €       │      │ none: blocked by kuciste │
│ iPhone 14 256GB kao nov    │ 560 €      │ yes  │                          │
│ iPhone 13 64GB             │ 400 €      │      │ all: missing (128|256)   │
```

Nothing is sent and state isn't touched, so run it as often as you like while tuning. That feedback loop is the whole point — write a rough filter, run `--dry`, read the `why` column, tighten.

If it reports 0 listings you're either blocked or the markup changed. The selector is `a[href*='-oglas-']` plus the nearest `li`/`article` for price; that URL pattern has been stable for years, the CSS classes have not.

## Search URLs

Open Njuskalo in a browser, set the filters, **sort by newest**, copy the URL from the address bar. Don't hand-write query params.

For filter-heavy categories (apartments, cars) that you'll tune or run for several cities, `njuskalo.ts` exports `search(name, path, filters)`. Each filter is a line keyed by Njuskalo's own param name (`"price[max]"`, `"geo[locationIds]"`, `"livingArea[min]"`), so you adjust any of them without editing a URL. See the apartment example in `searches.ts`; copy the block to add a city.

Server-side filters (category, price band, region) are cheaper than doing it here, since they cut what gets fetched. Use `searches.ts` for what the site can't express: title keywords, exclusions, regex.

`pages` defaults to 1, which is fine when polling frequently.

## Setup

**Telegram**

1. Message `@BotFather`, send `/newbot`, pick a display name and a username ending in `bot`. It replies with a token like `1234567890:AAH...`.
2. Open a chat with your new bot and press **Start**. Bots cannot message you first, so this is required.
3. Get your chat ID either by messaging `@userinfobot`, which replies with your numeric ID, or by opening `https://api.telegram.org/bot<TOKEN>/getUpdates` and reading `result[0].message.chat.id`. An empty `result` means you skipped step 2.

**Deploy**

```bash
git init && git add -A && git commit -m "init" && git push
```

Settings → Secrets and variables → Actions → add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Then Actions → Run workflow to test.

The first run **seeds**: it records everything currently listed and sends nothing. The second run onwards reports new ads only. That way you don't get 50 messages on day one.

`npm run reset` clears state and makes the next run seed again.

## Known failure modes

**Datacenter IP.** GitHub runners come from Azure ranges that anti-bot systems rank poorly. The headless browser clears Njuskalo's normal JS challenge, but if a run still parses 0 listings, a harder block (or a markup change) is the likely cause, not your filters.

**Cron lag.** `*/15` is the earliest, not the actual. Scheduled workflows are delayed 5–30 minutes routinely and occasionally skipped entirely.

**Free tier.** Public repo: standard runners are free and unlimited. Private repo: 2,000 minutes/month and every job bills rounded up to a full minute, so `*/15` is ~2,920 minutes and dies around the 21st. Use `*/30` on a private repo.

**Quiet zero.** Parsing 0 listings is treated as an error and sends a warning, not as "nothing new". Without that the scraper dies and you assume the market is quiet.

**Public repo note.** `searches.ts` reveals what you're hunting. If that matters, gitignore it and write it from a secret in the workflow before the run step.
