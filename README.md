# njuskalo-watch

Polls Njuskalo searches and sends a Telegram message when something new matches. No server, runs on a GitHub Actions cron.

```
watch.ts                     engine (renders each page in headless Chromium)
types.ts                     Search / Listing types
searches.json                what you hunt (name + URL per search)
docs/index.html              web UI to edit searches.json, hosted on GitHub Pages
njuskalo.ts                  optional helper to build a URL from a filters object
state/seen.json              committed ad IDs (automatic)
.github/workflows/watch.yml  cron
```

Add or edit searches in the **web UI** (GitHub Pages) — it commits `searches.json`
for you, no code and no manual commit. The cron reads that file on its next run.
Power users can also hand-edit `searches.json` directly.

Njuskalo is behind a bot wall (Radware), so a plain HTTP request just gets a JS
challenge. The fetch runs a real headless browser (Playwright/Chromium) that
clears the challenge and returns the actual markup.

## Writing filters

Searches live in `searches.json`. The web UI writes the two fields you need — a
name and the Njuskalo URL — but the file supports the full set for anyone editing
it by hand:

```json
{
  "searches": [
    {
      "name": "iPhone",
      "url": "https://www.njuskalo.hr/mobiteli?sort=new",
      "enabled": true,
      "all":  [["iphone"], ["iphone 13", "iphone 14"], ["128", "256"]],
      "none": ["kuciste", "maskica", "zamjena", "za dijelove", "kupujem"],
      "price": { "max": 600 }
    }
  ]
}
```

`enabled: false` parks a search without deleting it. Most Njuskalo filters
(price, area, rooms, region) are better set on the site and baked into the URL;
the fields below are for what the URL can't express — title keywords the UI
exposes `none` as its "exclude words". Three list fields, each holding **groups**.
A group is one pattern or an array of alternatives.

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

In the UI you just paste the URL. If you'd rather build one from filter fields in
code, `njuskalo.ts` exports `search(name, path, filters)` keyed by Njuskalo's own
params (`"price[max]"`, `"geo[locationIds]"`, ...) — handy for generating a URL to
drop into `searches.json`.

Server-side filters (category, price band, region) are cheaper than doing it here, since they cut what gets fetched. Use the title fields for what the site can't express: keywords, exclusions, regex.

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

**Search UI (GitHub Pages)**

1. Settings → Pages → Source: *Deploy from a branch* → branch `main`, folder `/docs`. Your UI is at `https://<you>.github.io/<repo>/`.
2. Create a **fine-grained token** at github.com → Settings → Developer settings → *Fine-grained tokens*: scope it to this one repo, permission *Contents → Read and write*.
3. Open the Pages URL, paste the token under **Connection**, and manage searches. Each save is an automated commit to `searches.json`; the next cron run picks it up. The token is stored only in your browser.

## Known failure modes

**Datacenter IP.** GitHub runners come from Azure ranges that anti-bot systems rank poorly. The headless browser clears Njuskalo's normal JS challenge, but if a run still parses 0 listings, a harder block (or a markup change) is the likely cause, not your filters.

**Cron lag.** `*/15` is the earliest, not the actual. Scheduled workflows are delayed 5–30 minutes routinely and occasionally skipped entirely.

**Free tier.** Public repo: standard runners are free and unlimited. Private repo: 2,000 minutes/month and every job bills rounded up to a full minute, so `*/15` is ~2,920 minutes and dies around the 21st. Use `*/30` on a private repo.

**Quiet zero.** Parsing 0 listings is treated as an error and sends a warning, not as "nothing new". Without that the scraper dies and you assume the market is quiet.

**Public repo note.** `searches.json` reveals what you're hunting, and the UI needs a repo-scoped GitHub token (kept only in your browser). If that matters, make the repo private — Actions still runs, though scheduled cron then counts against the 2,000-minute free quota, so use `*/30`.
