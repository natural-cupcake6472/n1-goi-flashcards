import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const studySite = join(import.meta.dir, "..");
const script = join(studySite, "scripts/compile-knowledge.ts");
const scratch = "/tmp/opencode";

type FixtureCard = { japanese: string; order: number; sourceLines?: number[]; status?: string; evidence?: unknown[] };
type FixtureEntry = {
  japanese: string;
  kana: string;
  en: string;
  vi: string;
  ja: string;
  parts: { text: string; kana?: string; en: string; vi: string; ja: string }[];
};

let siteSeq = 0;
const makeSite = async (catalog: Record<string, FixtureCard[]>, batches: Record<string, unknown[]>) => {
  const site = join(scratch, `ck-test-${process.pid}-${Date.now()}-${siteSeq++}`);
  const knowledge = join(site, "_knowledge");
  await mkdir(join(site, "src/catalog"), { recursive: true });
  await mkdir(knowledge, { recursive: true });
  for (const [file, cards] of Object.entries(catalog)) {
    await Bun.write(join(site, "src/catalog", file), JSON.stringify(cards, null, 2) + "\n");
  }
  for (const [file, entries] of Object.entries(batches)) {
    await Bun.write(join(knowledge, file), JSON.stringify(entries, null, 2) + "\n");
  }
  return { site, knowledge };
};

const run = (site: string, knowledge: string) =>
  Bun.spawnSync([process.execPath, script], {
    cwd: studySite,
    env: { ...process.env, SITE_ROOT: site, KNOWLEDGE_DIR: knowledge },
    stdout: "pipe",
    stderr: "pipe",
  });

const readJson = async (path: string) => JSON.parse(await Bun.file(path).text());
const outputs = async (site: string) => ({
  deck: await Bun.file(join(site, "src/generated/deck.json")).text(),
  manifest: await Bun.file(join(site, "src/generated/manifest.json")).text(),
  loader: await Bun.file(join(site, "src/generated/knowledge-loader.ts")).text(),
  compat: await Bun.file(join(site, "src/knowledge.generated.json")).text(),
  warnings: await Bun.file(join(site, "src/generated/knowledge-warnings.json")).text(),
});

/** One part; kana is a reading of the whole card, so the reading gate passes for any fixture text. */
const entry = (japanese: string, kana = "かなよみ"): FixtureEntry => ({
  japanese,
  kana,
  en: `en ${japanese}`,
  vi: `vi ${japanese}`,
  ja: `ja ${japanese}`,
  parts: [{ text: japanese, kana, en: `en ${japanese}`, vi: `vi ${japanese}`, ja: `ja ${japanese}` }],
});

describe("compile-knowledge", () => {
  test("emits ordered deck text with provenance stripped and lazy chunks", async () => {
    const { site, knowledge } = await makeSite(
      {
        "a.json": [
          { japanese: "二番目", order: 1, sourceLines: [4], status: "candidate", evidence: [{ file: "p.txt", line: 4, text: "二番目" }] },
          { japanese: "一番目", order: 0, sourceLines: [1], status: "candidate", evidence: [] },
        ],
        "b.json": [
          { japanese: "四番目", order: 3 },
          { japanese: "三番目", order: 2, status: "unmatched" },
        ],
      },
      { "cards-0001.json": [entry("一番目"), entry("三番目"), entry("四番目")] },
    );
    const result = run(site, knowledge);
    expect(result.exitCode).toBe(0);

    const deck = await readJson(join(site, "src/generated/deck.json"));
    expect(deck).toEqual(["一番目", "二番目", "三番目", "四番目"]);
    // Provenance never reaches the browser payload.
    expect(JSON.stringify(deck)).not.toContain("sourceLines");
    expect(JSON.stringify(deck)).not.toContain("evidence");

    const chunk = await readJson(join(site, "src/generated/knowledge/chunk-0000.json"));
    expect(Object.keys(chunk)).toEqual(["一番目", "三番目", "四番目"]);
    // Card 2 has no knowledge: not fabricated, simply absent.
    expect(chunk["二番目"]).toBeUndefined();

    const manifest = await readJson(join(site, "src/generated/manifest.json"));
    expect(manifest).toEqual({
      cards: 4,
      chunkSize: 32,
      chunks: 1,
      knowledgeEntries: 3,
      knowledgeFiles: 1,
      warnings: { coarseSinglePart: 0 },
    });

    const loader = await Bun.file(join(site, "src/generated/knowledge-loader.ts")).text();
    expect(loader).toContain("export const CHUNK_COUNT = 1;");
    expect(loader).toContain(`import("./knowledge/chunk-0000.json")`);

    // Compatibility artifact keeps the full entry shape for non-browser consumers.
    const compat = await readJson(join(site, "src/knowledge.generated.json"));
    expect(Object.keys(compat).sort()).toEqual(["一番目", "三番目", "四番目"]);
    expect(compat["三番目"].parts[0].text).toBe("三番目");
  });

  test("chunk boundaries follow deck index and the generated loader serves them", async () => {
    const cards: FixtureCard[] = Array.from({ length: 33 }, (_, i) => ({ japanese: `語${String(i).padStart(3, "0")}`, order: i }));
    const { site, knowledge } = await makeSite({ "a.json": cards }, {
      "cards-0001.json": cards.map((card) => entry(card.japanese)),
    });
    expect(run(site, knowledge).exitCode).toBe(0);

    const chunk0 = await readJson(join(site, "src/generated/knowledge/chunk-0000.json"));
    const chunk1 = await readJson(join(site, "src/generated/knowledge/chunk-0001.json"));
    expect(Object.keys(chunk0)).toHaveLength(32);
    expect(Object.keys(chunk1)).toEqual(["語032"]);

    const loader = await import(join(site, "src/generated/knowledge-loader.ts"));
    expect(loader.CHUNK_SIZE).toBe(32);
    expect(loader.CHUNK_COUNT).toBe(2);
    expect(loader.chunkIdForCard(31)).toBe(0);
    expect(loader.chunkIdForCard(32)).toBe(1);
    expect((await loader.loadChunk(0))["語000"].parts[0].text).toBe("語000");
    expect((await loader.loadChunk(32))["語032"].en).toBe("en 語032");
    // Beyond the last chunk nothing resolves (no fabrication).
    expect(loader.chunkIdForCard(64)).toBe(2);
    expect(await loader.loadChunk(64)).toBeUndefined();
    expect(await loader.loadChunk(-1)).toBeUndefined();
  });

  test("is idempotent and leaves artifacts untouched when a gate fails", async () => {
    const cards: FixtureCard[] = [{ japanese: "一番目", order: 0 }, { japanese: "二番目", order: 1 }];
    const { site, knowledge } = await makeSite({ "a.json": cards }, { "cards-0001.json": [entry("一番目")] });
    expect(run(site, knowledge).exitCode).toBe(0);
    const before = await outputs(site);

    expect(run(site, knowledge).exitCode).toBe(0);
    expect(await outputs(site)).toEqual(before);

    // Duplicate order is a hard error: the deck order could not be preserved deterministically.
    await Bun.write(join(site, "src/catalog", "a.json"), JSON.stringify([
      { japanese: "一番目", order: 0 },
      { japanese: "二番目", order: 0 },
    ]));
    const duplicateOrder = run(site, knowledge);
    expect(duplicateOrder.exitCode).toBe(1);
    expect(duplicateOrder.stderr.toString()).toContain("Duplicate catalog order 0");
    expect(await outputs(site)).toEqual(before);
  });

  test("keeps validation gates for knowledge batches", async () => {
    const cards: FixtureCard[] = [
      { japanese: "一番目", order: 0 },
      { japanese: "二番目", order: 1 },
      { japanese: "三番目", order: 2 },
    ];

    const cases: { name: string; entries: unknown[]; message: string }[] = [
      { name: "unknown card", entries: [entry("居ない単語")], message: "unknown card" },
      {
        name: "missing translation",
        entries: [{ ...entry("二番目"), vi: "  " }],
        message: "missing translation",
      },
      {
        name: "parts do not reproduce card",
        entries: [{ ...entry("二番目"), parts: [{ ...entry("三番目").parts[0] }] }],
        message: "parts do not reproduce card",
      },
      {
        name: "missing reading",
        entries: [{ ...entry("二番目"), parts: [{ text: "二番目", en: "x", vi: "x", ja: "x" }] }],
        message: "incomplete breakdown",
      },
      {
        name: "duplicate card across batches",
        entries: [entry("一番目")],
        message: "duplicate card",
      },
    ];
    for (const testCase of cases) {
      const { site, knowledge } = await makeSite({ "a.json": cards }, {
        "cards-0001.json": [entry("一番目")],
        "cards-0002.json": testCase.entries,
      });
      const result = run(site, knowledge);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(testCase.message);
      expect(await Bun.file(join(site, "src/generated/deck.json")).exists()).toBe(false);
    }
  });

  test("warns about a one-part multiword sentence without failing the build", async () => {
    const sentence = "彼は毎朝、書斎で本を読んでいる。";
    const { site, knowledge } = await makeSite(
      { "a.json": [{ japanese: sentence, order: 0 }, { japanese: "静かだ", order: 1 }] },
      {
        "cards-0001.json": [
          entry(sentence, "かれはまいあさしょさいでほんをよんでいる"),
          entry("静かだ", "しずかだ"),
        ],
      },
    );
    const result = run(site, knowledge);
    expect(result.exitCode).toBe(0);
    const stderr = result.stderr.toString();
    expect(stderr).toContain("WARNING: 1 suspect coarse breakdown");
    expect(stderr).toContain("Non-blocking");
    expect(stderr).toContain(sentence);
    expect(result.stdout.toString()).toContain("Coarse-breakdown warnings: 1");

    // Warning is recorded and does not suppress any artifact.
    const manifest = await readJson(join(site, "src/generated/manifest.json"));
    expect(manifest.warnings).toEqual({ coarseSinglePart: 1 });
    const chunk = await readJson(join(site, "src/generated/knowledge/chunk-0000.json"));
    expect(Object.keys(chunk)).toEqual([sentence, "静かだ"]);
    const recorded = await readJson(join(site, "src/generated/knowledge-warnings.json"));
    expect(recorded.count).toBe(1);
    expect(recorded.samples).toEqual([{ file: "cards-0001.json", japanese: sentence, length: 14, kanaBoundaries: 3 }]);

    // Re-running reports the same count and leaves every artifact byte-identical.
    const before = await outputs(site);
    const again = run(site, knowledge);
    expect(again.exitCode).toBe(0);
    expect(again.stderr.toString()).toContain("WARNING: 1 suspect coarse breakdown");
    expect(await outputs(site)).toEqual(before);
  });

  test("does not warn for genuine single-word cards or multi-part sentences", async () => {
    const compound = "国際連合安全保障理事会";
    const loanword = "レスポンシビリティー";
    const shortSentence = "心身ともに疲弊する";
    const split = "彼は毎朝、書斎で本を読んでいる。";
    const splitParts = [
      { text: "彼は", kana: "かれは" },
      { text: "毎朝、", kana: "まいあさ、" },
      { text: "書斎で", kana: "しょさいで" },
      { text: "本を", kana: "ほんを" },
      { text: "読んでいる。", kana: "よんでいる。" },
    ].map((part) => ({ ...part, en: `en ${part.text}`, vi: `vi ${part.text}`, ja: `ja ${part.text}` }));
    const { site, knowledge } = await makeSite(
      { "a.json": [compound, loanword, shortSentence, split].map((japanese, order) => ({ japanese, order })) },
      {
        "cards-0001.json": [
          entry(compound, "こくさいれんごうあんぜんほしょうりじかい"),
          entry(loanword, loanword),
          entry(shortSentence, "しんしんともにひへいする"),
          {
            japanese: split,
            kana: "かれはまいあさ、しょさいでほんをよんでいる。",
            en: `en ${split}`,
            vi: `vi ${split}`,
            ja: `ja ${split}`,
            parts: splitParts,
          },
        ],
      },
    );
    const result = run(site, knowledge);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).not.toContain("WARNING");
    expect(result.stdout.toString()).toContain("Coarse-breakdown warnings: 0");
    const manifest = await readJson(join(site, "src/generated/manifest.json"));
    expect(manifest.warnings).toEqual({ coarseSinglePart: 0 });
  });

  test("applies the length bound explicitly and still fails hard on gate errors", async () => {
    const nine = "朝からとても良い天。";
    const ten = "今日はとても良い天気。";
    const { site, knowledge } = await makeSite(
      { "a.json": [{ japanese: nine, order: 0 }, { japanese: ten, order: 1 }] },
      { "cards-0001.json": [entry(nine, "あさからとてもよいひ"), entry(ten, "きょうはとてもよいてんき")] },
    );
    const result = run(site, knowledge);
    expect(result.exitCode).toBe(0);
    const stderr = result.stderr.toString();
    expect(stderr).toContain("WARNING: 1 suspect coarse breakdown");
    expect(stderr).toContain(ten);
    expect(stderr).not.toContain(nine);
    expect((await readJson(join(site, "src/generated/manifest.json"))).warnings).toEqual({ coarseSinglePart: 1 });

    // A gate error still wins: no warning summary, no artifact rewrite.
    const before = await outputs(site);
    await Bun.write(join(knowledge, "cards-0002.json"), JSON.stringify([entry("居ない単語")]));
    const broken = run(site, knowledge);
    expect(broken.exitCode).toBe(1);
    expect(broken.stderr.toString()).toContain("unknown card");
    expect(broken.stderr.toString()).not.toContain("suspect coarse breakdown");
    expect(await outputs(site)).toEqual(before);
  });

  test("caps warning detail at a bounded number of samples", async () => {
    const cards = Array.from({ length: 25 }, (_, i) => ({ japanese: `今日はとても良い天気${i}`, order: i }));
    const { site, knowledge } = await makeSite(
      { "a.json": cards },
      { "cards-0001.json": cards.map((card) => entry(card.japanese, "きょうはとてもよいてんき")) },
    );
    const result = run(site, knowledge);
    expect(result.exitCode).toBe(0);
    const stderr = result.stderr.toString();
    expect(stderr).toContain("WARNING: 25 suspect coarse breakdown");
    expect(stderr).toContain("... 5 more");
    const recorded = await readJson(join(site, "src/generated/knowledge-warnings.json"));
    expect(recorded.count).toBe(25);
    expect(recorded.samples).toHaveLength(20);
  });

  test("scales to 2266 cards without an eager knowledge payload", async () => {
    const cards: FixtureCard[] = Array.from({ length: 2266 }, (_, i) => ({ japanese: `語${String(i).padStart(4, "0")}`, order: i }));
    const realistic = (japanese: string): FixtureEntry => ({
      japanese,
      kana: "かなよみ",
      en: `An English explanation of ${japanese} that is roughly the length of the real compiled payload.`,
      vi: `Một lời giải thích tiếng Việt cho ${japanese} có độ dài tương tự dữ liệu thật đã biên dịch.`,
      ja: `${japanese}についての日本語の説明文です。実際のデータと同じくらいの長さにしています。`,
      parts: [{
        text: japanese,
        kana: "かなよみ",
        en: `Part explanation for ${japanese} in English with a sentence of normal length.`,
        vi: `Giải thích thành phần cho ${japanese} bằng tiếng Việt với một câu dài bình thường.`,
        ja: `${japanese}の部分についての日本語の説明文です。ふつうの長さの文にしています。`,
      }],
    });
    const { site, knowledge } = await makeSite(
      {
        "a.json": cards.filter((card) => card.order % 2 === 0),
        "b.json": cards.filter((card) => card.order % 2 === 1),
      },
      {
        "cards-0001.json": cards.filter((card) => card.order % 2 === 0).map((card) => realistic(card.japanese)),
        "cards-0002.json": cards.filter((card) => card.order % 2 === 1).map((card) => realistic(card.japanese)),
      },
    );
    const result = run(site, knowledge);
    expect(result.exitCode).toBe(0);

    const deckText = await Bun.file(join(site, "src/generated/deck.json")).text();
    const deck = JSON.parse(deckText);
    expect(deck).toHaveLength(2266);
    expect(deck[0]).toBe("語0000");
    expect(deck[2265]).toBe("語2265");
    // Eager payload is card text only.
    expect(deckText.length).toBeLessThan(90_000);

    const manifest = await readJson(join(site, "src/generated/manifest.json"));
    expect(manifest).toEqual({
      cards: 2266,
      chunkSize: 32,
      chunks: 71,
      knowledgeEntries: 2266,
      knowledgeFiles: 2,
      warnings: { coarseSinglePart: 0 },
    });

    let maxChunk = 0;
    let totalChunk = 0;
    let entriesInChunks = 0;
    for (let id = 0; id < manifest.chunks; id++) {
      const text = await Bun.file(join(site, `src/generated/knowledge/chunk-${String(id).padStart(4, "0")}.json`)).text();
      const chunk = JSON.parse(text);
      entriesInChunks += Object.keys(chunk).length;
      maxChunk = Math.max(maxChunk, text.length);
      totalChunk += text.length;
    }
    expect(entriesInChunks).toBe(2266);
    // Every individual lazy chunk stays a small request, whatever the total size.
    expect(maxChunk).toBeLessThan(40_000);
    expect(totalChunk).toBeGreaterThan(deckText.length * 10);
  });
});
