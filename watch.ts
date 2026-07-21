import { load } from "cheerio";
import { chromium, type Browser } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Group, Listing, Pattern, Search } from "./types.ts";
import searches from "./searches.ts";

const STATE_PATH = "state/seen.json";
const BASE = "https://www.njuskalo.hr";
const RETENTION_DAYS = 30;
const MAX_ITEMS_PER_MESSAGE = 10;

/**
 * Njuskalo ad URLs always end in `-oglas-<id>`. Far more stable than CSS
 * classes, which change with every redesign.
 */
const AD_ID_RE = /-oglas-(\d+)(?:[/?#]|$)/;

/**
 * Croatian prices: "1.250,00 €" or "450 €". Deliberately no \s inside the
 * number, otherwise a card containing "Samsung Galaxy S21" and "280 €" parses
 * as 21280.
 */
const PRICE_RE = /\d{1,3}(?:[.\u00a0]\d{3})*(?:,\d{1,2})?\s*€/;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Send one test message and exit. Smoke test for credentials. */
const PING = process.argv.includes("--ping");

/** Show what was found and why it passed or failed, without sending or saving. */

const DRY = process.argv.includes("--dry");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Collapse ordinary whitespace but keep nbsp, which is used as a thousands separator. */
const flatten = (s: string) => s.replace(/[ \t\n\r]+/g, " ");

/**
 * Lowercase and strip diacritics so patterns match regardless of how the seller
 * typed it. Note that d-stroke has no NFD decomposition and needs its own rule.
 */
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d");

// ---------------------------------------------------------------- fetching

// Njuskalo sits behind Radware's bot manager, which blocks plain HTTP requests
// with a JavaScript challenge (a redirect to validate.perfdrive.com). Only a
// real browser that executes the challenge gets the page, so we render with
// headless Chromium. One browser is launched lazily and reused for the whole run.
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) browser = await chromium.launch({ headless: true });
  return browser;
}

async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

async function fetchPage(url: string): Promise<string> {
  const context = await (await getBrowser()).newContext({
    userAgent: UA,
    locale: "hr-HR",
    viewport: { width: 1366, height: 900 },
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Wait for the challenge to resolve into the real ad list. If it never does
    // (a hard block, or genuinely empty results), fall through with whatever
    // rendered; parseListings returning 0 then trips the "blocked" guard below.
    await page
      .waitForSelector("a[href*='-oglas-']", { timeout: 30_000 })
      .catch(() => {});
    await page.waitForTimeout(1000); // let late Vue hydration settle
    return await page.content();
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------- parsing

export function parsePrice(s: string): number | null {
  const n = Number(
    s
      .replace(/[^\d.,]/g, "")
      .replace(/[.\u00a0]/g, "")
      .replace(",", "."),
  );
  return Number.isFinite(n) ? n : null;
}

/**
 * Anchors that are never this search's results, and must be dropped:
 *
 *  - Cross-sell side rails Njuskalo injects on every page ("Posljednji oglasi",
 *    "Super Vau oglasi"): off-category (a page of phones lists a Lego set) and
 *    fully rotating each load, so scraping them fires a fresh false alert a run.
 *
 *  - The "Istaknute trgovine" FeaturedStore carousel: a store's own inventory,
 *    shown on every search while *ignoring the query's filters*. On a filtered
 *    apartment search (70 m2+, 3+ rooms) it still lists 22 m2 one-room flats, so
 *    it is pure noise. VauVau and Regular listings do respect the filters and
 *    stay.
 *
 * This keys on class names, against the usual rule of parsing by URL pattern, but
 * it only ever *removes* known chrome: if the class names change these blocks
 * simply reappear - exactly the older behaviour - rather than the parser breaking.
 */
const EXCLUDE_SELECTOR =
  "[class*='content-supplementary'], [class*='highlightedContentAside'], [class*='FeaturedStore']";

export function parseListings(html: string): Listing[] {
  const $ = load(html);
  const byId = new Map<string, Listing>();

  $("a[href*='-oglas-']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const id = href.match(AD_ID_RE)?.[1];
    if (!id) return;
    if ($(el).closest(EXCLUDE_SELECTOR).length) return; // rail or store promo, not a result

    const title = $(el).text().trim().replace(/\s+/g, " ");
    if (!title) return; // image links carry no text

    // One ad has several anchors (image, title, category). Keep the longest text.
    const prev = byId.get(id);
    if (prev && prev.title.length >= title.length) return;

    // Prefer a dedicated price element, fall back to the card text. Njuskalo's
    // promoted placements (SuperVau, FeaturedStore) render no price element at
    // all, so a null price here is normal, not a parse miss.
    const card = $(el)
      .closest("li, article, [class*='EntityList-item']")
      .first();
    const priceEl = card.find("[class*='price'], [class*='Price']").first();
    const priceElText = priceEl.length ? flatten(priceEl.text()).trim() : "";
    const amount =
      priceElText.match(PRICE_RE)?.[0] ??
      (card.length ? flatten(card.text()).match(PRICE_RE)?.[0] : undefined) ??
      null;
    // Show the rendered amount. If there is no number but the price slot spells
    // out a status like "Po dogovoru", show that verbatim for display - but keep
    // the numeric price null, never turn a status phrase into a guessed number.
    const priceText =
      amount ?? (priceElText && priceElText.length <= 40 ? priceElText : null);

    byId.set(id, {
      id,
      title,
      url: new URL(href, BASE).toString(),
      price: amount ? parsePrice(amount) : null,
      priceText,
    });
  });

  return [...byId.values()];
}

// ---------------------------------------------------------------- filtering

const patternCache = new Map<Pattern, RegExp>();

function compile(p: Pattern): RegExp {
  let re = patternCache.get(p);
  if (!re) {
    re = new RegExp(fold(p), "i");
    patternCache.set(p, re);
  }
  return re;
}

const hits = (haystack: string, g: Group): boolean =>
  (Array.isArray(g) ? g : [g]).some((p) => compile(p).test(haystack));

const label = (g: Group): string => (Array.isArray(g) ? `(${g.join("|")})` : g);

type Verdict = { ok: true } | { ok: false; reason: string };

/** Returns why a listing was rejected, so --dry can explain itself. */
function evaluate(l: Listing, s: Search): Verdict {
  const title = fold(l.title);

  if (s.price) {
    if (l.price == null) {
      if (s.price.required) return { ok: false, reason: "no price" };
    } else {
      const { min, max } = s.price;
      if (min != null && l.price < min)
        return { ok: false, reason: `price < ${min}` };
      if (max != null && l.price > max)
        return { ok: false, reason: `price > ${max}` };
    }
  }

  for (const g of s.all ?? []) {
    if (!hits(title, g))
      return { ok: false, reason: `all: missing ${label(g)}` };
  }

  if (s.any?.length && !s.any.some((g) => hits(title, g))) {
    return {
      ok: false,
      reason: `any: matched none of ${s.any.map(label).join(", ")}`,
    };
  }

  for (const g of s.none ?? []) {
    if (hits(title, g))
      return { ok: false, reason: `none: blocked by ${label(g)}` };
  }

  if (s.match && !s.match(l)) return { ok: false, reason: "match()" };

  return { ok: true };
}

// ---------------------------------------------------------------- state

type State = Record<string, Record<string, string>>;

async function loadState(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function saveState(state: State): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  for (const key of Object.keys(state)) {
    for (const [id, ts] of Object.entries(state[key])) {
      if (Date.parse(ts) < cutoff) delete state[key][id];
    }
  }
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

// ---------------------------------------------------------------- notifying

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let lastSend = 0;

async function notify(text: string, retry = true): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.log("[no telegram env, printing to stdout]\n" + text);
    return;
  }

  // Telegram allows roughly one message per second to the same chat, and we
  // send one message per search, so several searches at once would be a burst.
  const wait = 1100 - (Date.now() - lastSend);
  if (wait > 0) await sleep(wait);
  lastSend = Date.now();

  // Never log this URL: the token is in the path.
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
  });
  if (res.ok) return;

  const body = await res.text();
  if (res.status === 429 && retry) {
    const after = Number(JSON.parse(body)?.parameters?.retry_after ?? 5);
    console.warn(`telegram 429, waiting ${after}s`);
    await sleep((after + 1) * 1000);
    return notify(text, false);
  }
  console.error("telegram failed:", res.status, body);
}

function render(s: Search, items: Listing[]): string {
  const head = `🔔 <b>${esc(s.name)}</b> — ${items.length} new`;
  const body = items
    .slice(0, MAX_ITEMS_PER_MESSAGE)
    .map(
      (l) =>
        `• <a href="${l.url}">${esc(l.title.slice(0, 90))}</a>` +
        (l.priceText ? ` — <b>${esc(l.priceText)}</b>` : ""),
    )
    .join("\n");
  const more =
    items.length > MAX_ITEMS_PER_MESSAGE
      ? `\n…and ${items.length - MAX_ITEMS_PER_MESSAGE} more`
      : "";
  return `${head}\n${body}${more}`;
}

// ---------------------------------------------------------------- main

export function withPage(url: string, page: number): string {
  const u = new URL(url);
  u.searchParams.set("page", String(page));
  return u.toString();
}

async function main(): Promise<void> {
  if (PING) {
    await notify("✅ <b>njuskalo-watch</b>\nCredentials work.");
    console.log("ping sent");
    return;
  }

  const state = await loadState();
  const problems: string[] = [];

  for (const s of searches) {
    const seen = (state[s.name] ??= {});
    const isSeedRun = Object.keys(seen).length === 0;
    const fresh: Listing[] = [];

    for (let p = 1; p <= (s.pages ?? 1); p++) {
      const url = p === 1 ? s.url : withPage(s.url, p);
      let listings: Listing[];

      try {
        listings = parseListings(await fetchPage(url));
      } catch (e) {
        problems.push(`${s.name} p${p}: ${(e as Error).message}`);
        break;
      }

      // Zero listings is not "nothing new", it means we were blocked or the
      // markup changed. Without this the scraper dies quietly.
      if (listings.length === 0) {
        problems.push(
          `${s.name} p${p}: parsed 0 listings (blocked or markup changed?)`,
        );
        break;
      }

      if (DRY) {
        console.log(`\n=== ${s.name} p${p} — ${listings.length} listings`);
        console.table(
          listings.map((l) => {
            const v = evaluate(l, s);
            return {
              title: l.title.slice(0, 50),
              price: l.priceText ?? "—",
              pass: v.ok ? "yes" : "",
              why: v.ok ? "" : v.reason,
            };
          }),
        );
        continue;
      }

      for (const l of listings) {
        if (seen[l.id]) continue;
        seen[l.id] = new Date().toISOString();
        if (evaluate(l, s).ok) fresh.push(l);
      }

      if (p < (s.pages ?? 1)) await sleep(1500 + Math.random() * 2000);
    }

    if (DRY) continue;

    if (isSeedRun) {
      console.log(
        `${s.name}: seeded ${Object.keys(seen).length} listings, no alert sent`,
      );
      continue;
    }

    console.log(`${s.name}: ${fresh.length} new`);
    if (fresh.length) await notify(render(s, fresh));
  }

  if (DRY) {
    if (problems.length) console.error("problems:", problems);
    return;
  }

  await saveState(state);

  if (problems.length) {
    await notify(
      "⚠️ <b>njuskalo-watch</b>\n" +
        problems.map((p) => "• " + esc(p)).join("\n"),
    );
    process.exitCode = 1;
  }
}

// Only run the scraper when executed directly (tsx watch.ts). Importing this
// module for tests must not fire the network job.
const isEntryPoint =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(closeBrowser);
}
