import { mkdir } from "node:fs/promises";
import { join } from "node:path";

type Evidence = { file: string; line: number; text: string };
type Card = {
  japanese: string;
  order: number;
  sourceLines: number[];
  status: "candidate" | "ambiguous" | "unmatched";
  evidence: Evidence[];
};

const root = join(import.meta.dir, "..");
const desk = join(root, "..");
const sourcePath = join(desk, "n1-goi.txt");
const text = await Bun.file(sourcePath).text();
const normalize = (s: string) => s.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
const decisions: { source: string; study: string }[] = await Bun.file(join(import.meta.dir, "reconciliation-decisions.json")).json();
const corrections = new Map(decisions.map((decision) => [decision.source, decision.study]));
const canonical = (s: string) => {
  const trimmed = s.trim().replaceAll("ウィルス", "ウイルス");
  return corrections.get(trimmed) ?? trimmed;
};
const files = [...new Bun.Glob("*.txt").scanSync({ cwd: join(desk, "pdf-transcriptions") })].sort();
const lines: (Evidence & { normalized: string })[] = [];
for (const file of files) {
  const content = await Bun.file(join(desk, "pdf-transcriptions", file)).text();
  content.split(/\r?\n/).forEach((line, i) => {
    const normalized = normalize(line);
    if (normalized) lines.push({ file, line: i + 1, text: line.trim(), normalized });
  });
}

const entries = new Map<string, { order: number; sourceLines: number[] }>();
text.split(/\r?\n/).forEach((line, i) => {
  const japanese = canonical(line);
  if (!japanese) return;
  const existing = entries.get(japanese);
  if (existing) existing.sourceLines.push(i + 1);
  else entries.set(japanese, { order: entries.size, sourceLines: [i + 1] });
});

const buckets: Record<string, Card[]> = {};
for (const [japanese, origin] of entries) {
  const term = normalize(japanese);
  const exact = lines.filter((line) => line.normalized === term);
  const contained = term.length >= 2 ? lines.filter((line) => line.normalized.includes(term)) : [];
  const hits = exact.length ? exact : contained;
  const byFile = new Set(hits.map((hit) => hit.file));
  const status: Card["status"] = byFile.size === 1 ? "candidate" : byFile.size > 1 ? "ambiguous" : "unmatched";
  const bucket = status === "candidate" ? [...byFile][0] : "_needs-review.txt";
  const card: Card = {
    japanese, ...origin, status,
    evidence: hits.map(({ file, line, text: evidenceText }) => ({ file, line, text: evidenceText })),
  };
  (buckets[bucket] ??= []).push(card);
}

const out = join(root, "src/catalog");
await mkdir(out, { recursive: true });
for (const file of files) {
  await Bun.write(join(out, file.replace(/\.txt$/, ".json")), JSON.stringify(buckets[file] ?? [], null, 2) + "\n");
}
await Bun.write(join(out, "_needs-review.json"), JSON.stringify(buckets["_needs-review.txt"] ?? [], null, 2) + "\n");
const counts = { candidate: 0, ambiguous: 0, unmatched: 0 };
for (const batch of Object.values(buckets)) for (const card of batch) counts[card.status]++;
console.log(`Catalog: ${entries.size} unique cards; ${counts.candidate} single-file candidates, ${counts.ambiguous} ambiguous, ${counts.unmatched} unmatched.`);
console.log("Matching is a line-level screening, not confirmation that every transcription is correct.");
