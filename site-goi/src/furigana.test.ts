import { describe, expect, test } from "bun:test";
import { alignFurigana } from "./furigana";

describe("alignFurigana", () => {
  test("places reading over kanji, not okurigana", () => {
    expect(alignFurigana("挑む", "いどむ")).toEqual([
      { text: "挑", reading: "いど" }, { text: "む" },
    ]);
  });
  test("keeps kana-only words free of annotations", () => {
    expect(alignFurigana("チャンピオン", "チャンピオン")).toEqual([{ text: "チャンピオン" }]);
    expect(alignFurigana("ひらがな", "ひらがな")).toEqual([{ text: "ひらがな" }]);
  });
  test("aligns kana between kanji", () => {
    expect(alignFurigana("取り扱う", "とりあつかう")).toEqual([
      { text: "取", reading: "と" }, { text: "り" }, { text: "扱", reading: "あつか" }, { text: "う" },
    ]);
  });
  test("does not mistake the first reading character for the ending", () => {
    expect(alignFurigana("奪う", "うばう")).toEqual([
      { text: "奪", reading: "うば" }, { text: "う" },
    ]);
  });
  test("aligns an ending at the end even when its kana occurs earlier", () => {
    expect(alignFurigana("翻る", "ひるがえる")).toEqual([
      { text: "翻", reading: "ひるがえ" }, { text: "る" },
    ]);
  });
  test("does not invent alignment for incompatible readings", () => {
    expect(alignFurigana("食べる", "しょくじ")).toEqual([{ text: "食べる" }]);
    expect(alignFurigana("15時間", "じゅうごじかん")).toEqual([{ text: "15時間" }]);
  });
});
