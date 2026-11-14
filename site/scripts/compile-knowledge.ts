import { mkdir } from "node:fs/promises";
import { join } from "node:path";

type Language = "en" | "vi" | "ja";
type Part = Record<Language, string> & { text: string; kana?: string };
type Entry = Record<Language, string> & { japanese: string; kana: string; parts: Part[] };

/**
 * Cards are chunked by their position in the deck, not by the knowledge batch they came from:
 * the mapping is pure arithmetic (floor(index / CHUNK_SIZE)), so the browser never needs an
 * eager card -> chunk map. Re-running with more knowledge only fills chunks in place.
 */
const CHUNK_SIZE = 32;
const CHUNK_DIGITS = 4;

const root = process.env.SITE_ROOT ?? join(import.meta.dir, "..");
const catalogDir = join(root, "src/catalog");
const knowledgeDir = process.env.KNOWLEDGE_DIR ?? join(root, "../knowledge");
const generatedDir = join(root, "src/generated");
const chunksDir = join(generatedDir, "knowledge");

/** Knowledge batch workers write concurrently; a partially written file is a transient SyntaxError. */
const readJson = async (path: string): Promise<unknown> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const text = await Bun.file(path).text();
    try {
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      await Bun.sleep(30);
    }
  }
  throw new Error(`${path}: unreadable JSON (${lastError instanceof Error ? lastError.message : String(lastError)})`);
};

const catalogFiles = [...new Bun.Glob("*.json").scanSync({ cwd: catalogDir })].sort();
if (!catalogFiles.length) throw new Error("Card catalog is missing. Run bun scripts/reconcile-catalog.ts first.");

type CatalogCard = { japanese: string; order: number; file: string };
const catalog: CatalogCard[] = [];
for (const file of catalogFiles) {
  const batch: unknown = await readJson(join(catalogDir, file));
  if (!Array.isArray(batch)) throw new Error(`${file}: expected a catalog array`);
  for (const card of batch as { japanese?: unknown; order?: unknown }[]) {
    if (typeof card?.japanese !== "string" || !card.japanese) {
      throw new Error(`${file}: invalid or duplicate catalog card`);
    }
    if (typeof card.order !== "number" || !Number.isInteger(card.order) || card.order < 0) {
      throw new Error(`${file}: ${card.japanese}: missing numeric order`);
    }
    catalog.push({ japanese: card.japanese, order: card.order, file });
  }
}
// `order` is unique across the catalog, so this sort is total and independent of glob order.
catalog.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file) || a.japanese.localeCompare(b.japanese));
for (let i = 1; i < catalog.length; i++) {
  if (catalog[i].order === catalog[i - 1].order) {
    throw new Error(`Duplicate catalog order ${catalog[i].order} (${catalog[i - 1].file} and ${catalog[i].file})`);
  }
}
const deck = catalog.map((card) => card.japanese);
const cardIndex = new Map<string, number>();
deck.forEach((japanese, index) => {
  if (cardIndex.has(japanese)) throw new Error(`Duplicate catalog card: ${japanese}`);
  cardIndex.set(japanese, index);
});

const files = [...new Bun.Glob("cards-*.json").scanSync({ cwd: knowledgeDir })].sort();
const compiled: Record<string, Omit<Entry, "japanese" | "kana">> = {};
const errors: string[] = [];
const languages: Language[] = ["en", "vi", "ja"];

/**
 * Non-blocking review signal: a card whose whole breakdown is one part, so the learner gets a
 * single unsplit block for a multiword sentence. This is NOT a gate — valid one-word phrases
 * routinely run past five characters (e.g. レスポンシビリティ, 国際連合安全保障理事会).
 *
 * Explicit, bounded heuristic (all three must hold):
 *   1. exactly one part; and
 *   2. NFKC text with whitespace/punctuation/symbols removed is >= 10 characters; and
 *   3. the raw text carries clause punctuation, or >= 2 kana runs sitting between Han runs
 *      (particle boundaries, i.e. several words/segments).
 * Bounds: length threshold 10 characters, boundary threshold 2, at most 20 printed samples.
 */
const COARSE_BREAKDOWN = {
  minLength: 10,
  minKanaBoundaries: 2,
  maxSamples: 20,
  maxSampleChars: 40,
  punctuationChars: "、。！？!?，,",
  punctuation: /[、。！？!?，,]/u,
  kanaBoundary: /\p{Script=Han}[ぁ-ゖー]+(?=\p{Script=Han})/gu,
} as const;
const COARSE_HEURISTIC = `1 part && normalized length >= ${COARSE_BREAKDOWN.minLength} && (clause punctuation ${COARSE_BREAKDOWN.punctuationChars} || >= ${COARSE_BREAKDOWN.minKanaBoundaries} kana particle boundaries)`;

type CoarseWarning = { file: string; japanese: string; length: number; kanaBoundaries: number };
const coarseBreakdown = (file: string, item: Entry): CoarseWarning | undefined => {
  if (item.parts.length !== 1) return undefined;
  const text = item.parts[0].text;
  const normalized = text.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
  const length = [...normalized].length;
  if (length < COARSE_BREAKDOWN.minLength) return undefined;
  const kanaBoundaries = [...text.normalize("NFKC").matchAll(COARSE_BREAKDOWN.kanaBoundary)].length;
  if (!COARSE_BREAKDOWN.punctuation.test(text) && kanaBoundaries < COARSE_BREAKDOWN.minKanaBoundaries) return undefined;
  return { file, japanese: text, length, kanaBoundaries };
};
const warnings: CoarseWarning[] = [];

for (const file of files) {
  let data: unknown;
  try {
    data = await readJson(join(knowledgeDir, file));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    continue;
  }
  if (!Array.isArray(data)) { errors.push(`${file}: expected an array`); continue; }
  for (const item of data as Entry[]) {
    const id = `${file}: ${String(item?.japanese ?? "(missing Japanese)")}`;
    if (typeof item?.japanese !== "string" || !cardIndex.has(item.japanese)) { errors.push(`${id}: unknown card`); continue; }
    if (compiled[item.japanese]) { errors.push(`${id}: duplicate card`); continue; }
    if (!languages.every((lang) => typeof item[lang] === "string" && item[lang].trim())) { errors.push(`${id}: missing translation`); continue; }
    if (!Array.isArray(item.parts) || !item.parts.length || item.parts.some((part) =>
      typeof part?.text !== "string" || !part.text ||
      !languages.every((lang) => typeof part[lang] === "string" && part[lang].trim()) ||
      (/\p{Script=Han}/u.test(part.text) && (typeof part.kana !== "string" || !part.kana.trim()))
    )) { errors.push(`${id}: incomplete breakdown`); continue; }
    if (item.parts.map((part) => part.text).join("") !== item.japanese) { errors.push(`${id}: parts do not reproduce card`); continue; }
    if (typeof item.kana !== "string" || !item.kana.trim() || /\p{Script=Han}/u.test(item.kana)) { errors.push(`${id}: missing or incomplete reading`); continue; }
    const reading = (s: string) => s.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
    if (reading(item.parts.map((part) => part.kana || part.text).join("")) !== reading(item.kana)) { errors.push(`${id}: part readings do not reproduce full reading`); continue; }
    const warning = coarseBreakdown(file, item);
    if (warning) warnings.push(warning);
    compiled[item.japanese] = { en: item.en, vi: item.vi, ja: item.ja, parts: item.parts };
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
if (!deck.length) throw new Error("Catalog is empty; refusing to emit an empty deck.");

const chunkCount = Math.ceil(deck.length / CHUNK_SIZE);
const chunkName = (id: number) => `chunk-${String(id).padStart(CHUNK_DIGITS, "0")}`;
const chunks: Record<string, Omit<Entry, "japanese" | "kana">>[] = Array.from({ length: chunkCount }, () => ({}));
deck.forEach((japanese, index) => {
  const entry = compiled[japanese];
  if (entry) chunks[Math.floor(index / CHUNK_SIZE)][japanese] = entry;
});

const writeIfChanged = async (path: string, contents: string) => {
  const existing = await Bun.file(path).text().catch(() => undefined);
  if (existing === contents) return false;
  await Bun.write(path, contents);
  return true;
};

await mkdir(chunksDir, { recursive: true });

// Browser payload: ordered card text only. Provenance (sourceLines/status/evidence) stays in
// src/catalog/*.json, which remains the reconciliation record of truth.
const deckJson = JSON.stringify(deck);
// Compatibility artifact for non-browser consumers; not imported by the app.
const knowledgeJson = JSON.stringify(compiled);
const manifestJson = JSON.stringify({
  cards: deck.length,
  chunkSize: CHUNK_SIZE,
  chunks: chunkCount,
  knowledgeEntries: Object.keys(compiled).length,
  knowledgeFiles: files.length,
  warnings: { coarseSinglePart: warnings.length },
}) + "\n";
// Bounded, durable view of the review signal: survives the build log, stays small.
const warningsJson = JSON.stringify({
  count: warnings.length,
  heuristic: COARSE_HEURISTIC,
  samples: warnings.slice(0, COARSE_BREAKDOWN.maxSamples).map((warning) => ({
    file: warning.file,
    japanese: [...warning.japanese].slice(0, COARSE_BREAKDOWN.maxSampleChars).join(""),
    length: warning.length,
    kanaBoundaries: warning.kanaBoundaries,
  })),
}) + "\n";
const loader = [
  "// AUTO-GENERATED by scripts/compile-knowledge.ts. Do not edit by hand.",
  "export type KnowledgePart = { text: string; kana?: string; en: string; vi: string; ja: string };",
  "export type KnowledgeEntry = { en: string; vi: string; ja: string; parts: KnowledgePart[] };",
  "export type KnowledgeChunk = Record<string, KnowledgeEntry>;",
  "",
  `export const CHUNK_SIZE = ${CHUNK_SIZE};`,
  `export const CHUNK_COUNT = ${chunkCount};`,
  "export const CARD_COUNT = " + deck.length + ";",
  "",
  "export const chunkIdForCard = (index: number): number => Math.floor(index / CHUNK_SIZE);",
  "",
  "type ChunkModule = { default: KnowledgeChunk };",
  "const loaders: Array<() => Promise<ChunkModule>> = [",
  ...chunks.map((_, id) => `  () => import("./knowledge/${chunkName(id)}.json"),`),
  "];",
  "",
  "/** Loads the knowledge chunk that covers a 0-based deck index. Missing chunks map to undefined. */",
  "export const loadChunk = async (index: number): Promise<KnowledgeChunk | undefined> => {",
  "  const id = chunkIdForCard(index);",
  "  const loader = Number.isInteger(id) && id >= 0 ? loaders[id] : undefined;",
  "  if (!loader) return undefined;",
  "  try {",
  "    return (await loader()).default;",
  "  } catch {",
  "    return undefined;",
  "  }",
  "};",
  "",
].join("\n");

const written: string[] = [];
for (let id = 0; id < chunkCount; id++) {
  const name = chunkName(id);
  if (await writeIfChanged(join(chunksDir, `${name}.json`), JSON.stringify(chunks[id]))) written.push(name);
}
if (await writeIfChanged(join(generatedDir, "knowledge-loader.ts"), loader)) written.push("knowledge-loader.ts");
if (await writeIfChanged(join(generatedDir, "manifest.json"), manifestJson)) written.push("manifest.json");
if (await writeIfChanged(join(generatedDir, "knowledge-warnings.json"), warningsJson)) written.push("knowledge-warnings.json");
if (await writeIfChanged(join(generatedDir, "deck.json"), deckJson)) written.push("deck.json");
if (await writeIfChanged(join(root, "src/knowledge.generated.json"), knowledgeJson)) written.push("knowledge.generated.json");

if (warnings.length) {
  const shown = warnings.slice(0, COARSE_BREAKDOWN.maxSamples);
  console.error(`\nWARNING: ${warnings.length} suspect coarse breakdown(s) — a single part covering a multiword sentence. Non-blocking: the build continues and all gates above still apply.`);
  console.error(`Heuristic: ${COARSE_HEURISTIC}.`);
  for (const warning of shown) {
    console.error(`  ${warning.file}: ${[...warning.japanese].slice(0, COARSE_BREAKDOWN.maxSampleChars).join("")} (${warning.length} chars, ${warning.kanaBoundaries} kana boundary)`);
  }
  if (warnings.length > shown.length) {
    console.error(`  ... ${warnings.length - shown.length} more; see warnings.coarseSinglePart in src/generated/manifest.json`);
  }
  console.error(`  Review only: a warning is not a pass/fail signal for the card.`);
}

console.log(`Knowledge coverage: ${Object.keys(compiled).length}/${deck.length} unique cards from ${files.length} batch files.`);
console.log(`Deck: ${deck.length} cards in ${chunkCount} lazy chunks of ${CHUNK_SIZE} (${written.length} file(s) updated).`);
console.log(`Coarse-breakdown warnings: ${warnings.length} (non-blocking; recorded as warnings.coarseSinglePart in manifest.json).`);
