# n1-goi-flashcards

A mobile-first Japanese study deck built from an N1 preparation kanji workbook (20 lessons + N2 review), rendered with Qwik + Tailwind.

2,266 example sentences. Tap a card to reveal furigana, tap again for the translation and a per-word breakdown. Swipe left/right to move through the deck.


## Three decks

| folder | deck | local port |
|---|---|---|
| `site/` | kanji — 2,266 sentences over 631 kanji | 4177 |
| `site-goi/` | goi — 1,000 N1 words, tap for furigana then translation | 4181 |
| `site-grammar/` | grammar — 101 N1 patterns, tap for meaning then examples | 4182 |

Each deck has a 3-way switcher in the top bar (漢 / 語 / 文) plus its own admin sheet. All three share the same card shell (Qwik 1.20, Tailwind 4), swipe navigation, tap-to-reveal stages and local persistence.

## Views

- **Lessons** — walk a lesson end to end; a completion screen offers the next lesson.
- **Topics** — 27 themes, sentences can belong to several; a completion screen offers the next topic.
- **Kanji** — straight through the kanji order.
- **Random** — any card.

The admin sheet (ADMIN button) has arrow rows for View / Lesson-Topic and a History viewer. State and history live in the browser (localStorage, mirrored to IndexedDB), so a reload or a browser restart resumes exactly where you were. The URL stays clean.

## Furigana

Readings are precomputed per word and split per kanji where the reading decomposes into the characters' own readings. Words whose reading cannot be split (jukujikun such as 相撲 すもう, 景色 けしき) keep one reading spread across the word instead of inventing per-character readings.

## Run it

```bash
cd site
bun install
bun run build     # compiles knowledge + builds the static site into site/dist
bun run dev       # or: vite --mode ssr
```

The build reads the authored cards from `../knowledge` and the card catalog from `site/src/catalog`.

## Deploy to Cloudflare

The app is a static build, so it runs on Cloudflare's CDN with no server.

```bash
cd site
bunx wrangler login    # once, opens the browser
bun run build
bun run deploy         # wrangler deploy -> https://n1-goi-flashcards.<your-subdomain>.workers.dev
```

Config lives in `site/wrangler.toml` (Workers static assets, SPA fallback).
For Cloudflare Pages instead: `bun run deploy:pages`.

## Data

- `knowledge/cards-*.json` — sentences with English/Vietnamese/Japanese translations and per-word breakdowns.
- `site/src/generated/` — compiled deck, furigana map, kanji groups, lesson order, topics.

Content (sentences, translations, kanji/kana readings) is authored source data. Topic tags and display metadata are derived and can be regenerated.

## License

Content belongs to its original authors (Riki.edu.vn workbook). Code is provided as-is for personal study use.