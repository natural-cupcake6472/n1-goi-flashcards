# n1-goi-flashcards

A mobile-first Japanese study deck built from an N1 preparation kanji workbook (20 lessons + N2 review), rendered with Qwik + Tailwind.

2,266 example sentences. Tap a card to reveal furigana, tap again for the translation and a per-word breakdown. Swipe left/right to move through the deck.

## Views

- **Lessons** — walk a lesson end to end; a completion screen offers the next lesson.
- **Topics** — 27 themes, sentences can belong to several; a completion screen offers the next topic.
- **Kanji** — straight through the kanji order.
- **Random** — any card.

The admin sheet (ADMIN button) has arrow rows for View / Lesson-Topic and a History viewer. State and history live in the browser (localStorage) and the URL, so a reload resumes exactly where you were.

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

## Data

- `knowledge/cards-*.json` — sentences with English/Vietnamese/Japanese translations and per-word breakdowns.
- `site/src/generated/` — compiled deck, furigana map, kanji groups, lesson order, topics.

Content (sentences, translations, kanji/kana readings) is authored source data. Topic tags and display metadata are derived and can be regenerated.

## License

Content belongs to its original authors (Riki.edu.vn workbook). Code is provided as-is for personal study use.
