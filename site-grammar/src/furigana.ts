export type FuriganaSegment = { text: string; reading?: string };

const kanaOnly = (s: string) => [...s.normalize("NFKC")]
  .filter((c) => /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(c))
  .map((c) => {
    const code = c.codePointAt(0)!;
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : c;
  }).join("");

/** Align known kana anchors; suppress annotations when alignment is ambiguous. */
export function alignFurigana(text: string, reading?: string): FuriganaSegment[] {
  const plain = [{ text }];
  if (!reading || !/\p{Script=Han}/u.test(text)) return plain;
  if (/[0-9０-９]/u.test(text)) return plain;
  const runs = text.match(/\p{Script=Han}+|[^\p{Script=Han}]+/gu);
  if (!runs) return plain;
  const full = kanaOnly(reading);
  const result: FuriganaSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!/\p{Script=Han}/u.test(run)) {
      const anchor = kanaOnly(run);
      if (anchor && full.slice(cursor, cursor + anchor.length) !== anchor) return plain;
      cursor += anchor.length;
      result.push({ text: run });
      continue;
    }
    const suffix = runs[i + 1];
    const anchor = suffix ? kanaOnly(suffix) : "";
    if (suffix && !anchor && runs.slice(i + 2).some((s) => /\p{Script=Han}/u.test(s))) return plain;
    const lastAnchor = suffix && !runs.slice(i + 2).some((s) => /\p{Script=Han}/u.test(s));
    const end = anchor
      ? lastAnchor ? full.length - anchor.length : full.indexOf(anchor, cursor + 1)
      : full.length;
    if (end <= cursor) return plain;
    result.push({ text: run, reading: full.slice(cursor, end) });
    cursor = end;
  }
  return cursor === full.length ? result : plain;
}
