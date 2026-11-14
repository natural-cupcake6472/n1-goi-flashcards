import { $, component$, useSignal, useTask$, useVisibleTask$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import deck from "../generated/deck.json";
import type { KnowledgeEntry } from "../generated/knowledge-loader";
import furiganaMap from "../generated/furigana.json";
import kanjiMap from "../generated/kanji.json";
import lessonOrder from "../generated/lesson-order.json";
import topicsData from "../generated/topics.json";

type Unit = { text: string; reading?: string; whole?: boolean };
type Mode = "lesson" | "topic" | "group" | "random";
type Lesson = { id: string; label: string; start: number; count: number };
type Topic = { id: string; label: string; count: number };
type Visit = { index: number; at: number };
type Stored = { index: number; reveal: number; lang: "en" | "vi" | "ja"; mode: Mode; topic: string };

const FURI = new Map<string, { units: Unit[]; verified: boolean }>(
  (furiganaMap.entries as { text: string; kana: string; units: Unit[]; verified: boolean }[]).map((e) => [
    e.text + "\u0000" + e.kana,
    { units: e.units, verified: e.verified },
  ]),
);
const unitsFor = (text: string, kana?: string): Unit[] => {
  const entry = kana ? FURI.get(text + "\u0000" + kana) : undefined;
  if (entry) return entry.verified ? entry.units : entry.units.map((u) => ({ ...u, whole: true }));
  return [{ text, reading: kana && /\p{Script=Han}/u.test(text) ? kana : undefined, whole: true }];
};

const displayOrder: number[] = (lessonOrder as { order: number[] }).order;
const lessons: Lesson[] = (lessonOrder as { lessons: Lesson[] }).lessons;
const topicList: Topic[] = (topicsData as { topics: Topic[] }).topics;
const topicSequences: Record<string, number[]> = (topicsData as { sequences: Record<string, number[]> }).sequences;
const deckIndex = (position: number) => displayOrder[position] ?? 0;
const cards: string[] = displayOrder.map((i) => deck[i]);
const kanjiAll: (string | null)[] = (kanjiMap as { cardKanji: (string | null)[] }).cardKanji;
const cardKanji: (string | null)[] = displayOrder.map((i) => kanjiAll[i] ?? null);
const lessonAt = (position: number): Lesson =>
  lessons.find((l) => position >= l.start && position < l.start + l.count) ?? lessons[0];
const nextPosition = (position: number, dir: number, mode: Mode, topicId: string): number | null => {
  if (mode === "random") return null;
  if (mode === "topic") {
    const sequence = topicSequences[topicId] ?? [];
    const at = sequence.indexOf(position);
    if (at < 0) return null;
    return sequence[at + (dir > 0 ? -1 : 1)] ?? null;
  }
  const total = cards.length;
  return (position + (dir > 0 ? -1 : 1) + total) % total;
};

const STATE_KEY = "n1goi:state";
const historyKey = (mode: string) => "n1goi:history:" + mode;
const readState = (): Stored | null => {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
};
const writeState = (state: Stored) => {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked */
  }
};
const readHistory = (mode: string): Visit[] => {
  try {
    return JSON.parse(localStorage.getItem(historyKey(mode)) ?? "[]") as Visit[];
  } catch {
    return [];
  }
};
const pushHistory = (mode: string, index: number): Visit[] => {
  const list = readHistory(mode);
  if (list[0]?.index === index) return list;
  const next = [{ index, at: Date.now() }, ...list].slice(0, 300);
  try {
    localStorage.setItem(historyKey(mode), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
};

const PART_BG = ["bg-[#e0efe4]", "bg-[#f8e9d6]", "bg-[#e4e8f7]", "bg-[#f6e2e5]", "bg-[#e5eee7]"];
const SWIPE = 80;
const EASE = "transform 200ms ease-out, opacity 200ms ease-out";

export default component$(() => {
  const index = useSignal(0);
  const reveal = useSignal(0);
  const language = useSignal<"en" | "vi" | "ja">("en");
  const mode = useSignal<Mode>("lesson");
  const topic = useSignal<string>(topicList[0]?.id ?? "");
  const detail = useSignal<KnowledgeEntry | undefined>(undefined);
  const dragX = useSignal(0);
  const dragging = useSignal(false);
  const fading = useSignal(false);
  const transition = useSignal("none");
  const startX = useSignal(0);
  const startY = useSignal(0);
  const loaded = useSignal(false);
  const panelOpen = useSignal(false);
  const lessonDone = useSignal(false);
  const topicDone = useSignal(false);
  const picker = useSignal<"view" | "lesson" | "topic" | "history" | null>(null);
  const history = useSignal<Visit[]>([]);
  const historyTotal = useSignal(0);
  const remote = useSignal(false);

  useTask$(async ({ track }) => {
    const current = track(() => index.value);
    const japanese = cards[current];
    detail.value = undefined;
    if (!japanese) return;
    const { loadChunk } = await import("../generated/knowledge-loader");
    const chunk = await loadChunk(deckIndex(current));
    if (index.value !== current) return;
    detail.value = chunk?.[japanese];
    for (const offset of [1, 2, 3, 4, 5]) {
      const target =
        mode.value === "topic"
          ? topicSequences[topic.value]?.[(topicSequences[topic.value] ?? []).indexOf(current) + offset]
          : (current + offset) % cards.length;
      if (target === undefined) continue;
      void loadChunk(deckIndex(target)).catch(() => undefined);
    }
  });

  // Local state only: read once on the client, URL wins when it carries a card.
  useVisibleTask$(() => {
    const params = new URLSearchParams(location.search);
    const fromUrl = Number(params.get("card"));
    const stored = readState();
    if (Number.isFinite(fromUrl) && fromUrl >= 0 && fromUrl < cards.length) {
      index.value = fromUrl;
      const step = Number(params.get("reveal"));
      if (Number.isFinite(step)) reveal.value = Math.min(2, Math.max(0, step));
      const lang = params.get("lang");
      if (lang === "en" || lang === "vi" || lang === "ja") language.value = lang;
      const m = params.get("mode");
      if (m === "lesson" || m === "topic" || m === "group" || m === "random") mode.value = m;
      const t = params.get("topic");
      if (t && topicSequences[t]) topic.value = t;
    } else if (stored) {
      if (stored.index >= 0 && stored.index < cards.length) index.value = stored.index;
      reveal.value = Math.min(2, Math.max(0, stored.reveal ?? 0));
      if (stored.lang) language.value = stored.lang;
      if (stored.mode) mode.value = stored.mode;
      if (stored.topic && topicSequences[stored.topic]) topic.value = stored.topic;
    }
    history.value = readHistory(mode.value);
    historyTotal.value = history.value.length;
    loaded.value = true;
  });

  // Persist locally + reflect in the URL.
  useTask$(({ track }) => {
    const ready = track(() => loaded.value);
    const card = track(() => index.value);
    const step = track(() => reveal.value);
    const lang = track(() => language.value);
    const order = track(() => mode.value);
    const currentTopic = track(() => topic.value);
    if (!ready || typeof window === "undefined") return;
    writeState({ index: card, reveal: step, lang, mode: order, topic: currentTopic });
    if (!remote.value) {
      history.value = pushHistory(order, card);
      historyTotal.value = history.value.length;
    }
    remote.value = false;
    const url = new URL(window.location.href);
    url.searchParams.set("mode", order);
    url.searchParams.set("card", String(card));
    url.searchParams.set("reveal", String(step));
    url.searchParams.set("lang", lang);
    if (order === "topic") url.searchParams.set("topic", currentTopic);
    else url.searchParams.delete("topic");
    window.history.replaceState(null, "", url);
  });

  const finish = $((dx: number, dy: number) => {
    dragging.value = false;
    const isSwipe = Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy);
    if (!isSwipe) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) reveal.value = (reveal.value + 1) % 3;
      transition.value = EASE;
      dragX.value = 0;
      return;
    }

    const dir = Math.sign(dx);
    const forward = dir < 0;
    const total = cards.length;

    // Decide the destination before animating, so both directions behave the same.
    let destination: { kind: "card"; index: number } | { kind: "end"; which: "lesson" | "topic" } | null = null;
    if (mode.value === "random") {
      const next = Math.floor(Math.random() * total);
      destination = { kind: "card", index: next === index.value ? (next + 1) % total : next };
    } else if (mode.value === "topic") {
      const sequence = topicSequences[topic.value] ?? [];
      const at = sequence.indexOf(index.value);
      const target = at < 0 ? undefined : sequence[at + (forward ? 1 : -1)];
      if (target !== undefined) destination = { kind: "card", index: target };
      else if (forward) destination = { kind: "end", which: "topic" };
    } else if (mode.value === "lesson") {
      const lesson = lessonAt(index.value);
      const next = index.value + (forward ? 1 : -1);
      if (forward && next >= lesson.start + lesson.count) destination = { kind: "end", which: "lesson" };
      else if (!forward && next < lesson.start) destination = null;
      else destination = { kind: "card", index: next };
    } else {
      destination = { kind: "card", index: (index.value + (forward ? 1 : -1) + total) % total };
    }

    if (!destination) {
      transition.value = EASE;
      dragX.value = 0;
      return;
    }

    transition.value = EASE;
    dragX.value = dir * 620;
    fading.value = true;
    setTimeout(() => {
      if (!fading.value) return;
      transition.value = "none";
      dragX.value = 0;
      fading.value = false;
      reveal.value = 0;
      if (destination.kind === "card") index.value = destination.index;
      else if (destination.which === "topic") topicDone.value = true;
      else lessonDone.value = true;
    }, 420);
  });

  const cycleMode = $((dir: number) => {
    const list: Mode[] = ["lesson", "topic", "group", "random"];
    mode.value = list[(list.indexOf(mode.value) + dir + list.length) % list.length];
  });
  const cycleLesson = $((dir: number) => {
    const at = lessons.findIndex((lesson) => lesson.id === lessonAt(index.value).id);
    const next = lessons[(at + dir + lessons.length) % lessons.length];
    index.value = next.start;
    reveal.value = 0;
    lessonDone.value = false;
  });
  const cycleTopic = $((dir: number) => {
    const at = topicList.findIndex((item) => item.id === topic.value);
    const next = topicList[(at + dir + topicList.length) % topicList.length];
    topic.value = next.id;
    const first = topicSequences[next.id]?.[0];
    if (first !== undefined) index.value = first;
    mode.value = "topic";
    reveal.value = 0;
    topicDone.value = false;
  });
  const jumpToLesson = $((lesson: Lesson) => {
    index.value = lesson.start;
    reveal.value = 0;
    lessonDone.value = false;
  });
  const jumpToTopic = $((id: string) => {
    topic.value = id;
    const first = topicSequences[id]?.[0];
    if (first !== undefined) index.value = first;
    mode.value = "topic";
    reveal.value = 0;
    topicDone.value = false;
  });
  const openPanel = $(() => {
    panelOpen.value = true;
    history.value = readHistory(mode.value);
    historyTotal.value = history.value.length;
  });

  const card = cards[index.value];
  const previewPosition = nextPosition(index.value, -1, mode.value, topic.value) ?? (index.value + 1) % cards.length;
  const nextCard = cards[previewPosition];
  const info = detail.value;
  const kanjiNow = cardKanji[index.value] ?? "";
  const kanjiNext = cardKanji[previewPosition] ?? "";
  const typeLabel =
    mode.value === "lesson"
      ? lessonAt(index.value).label
      : mode.value === "topic"
        ? "Topic: " + (topicList.find((t) => t.id === topic.value)?.label ?? "")
        : mode.value === "group"
          ? "Kanji: " + (kanjiNow || "")
          : "Random";
  const sentenceClass = (isLoaded: boolean) =>
    `m-0 text-center font-serif text-[clamp(20px,5.8vw,29px)] leading-[1.9] [text-wrap:balance] transition-opacity duration-150 ${isLoaded ? "opacity-100" : "opacity-0"}`;

  return (
    <main class="fixed inset-0 flex select-none flex-col bg-[#f7f4ec] text-[#1f2a24]">
      <div class="flex h-10 items-center justify-end px-5">
        <button
          aria-label="Admin panel"
          class="rounded-full border border-[#ddd8c9] px-3 py-1.5 text-[10px] font-bold tracking-[0.16em] text-[#7c8b80] active:bg-[#ece7d9]"
          onClick$={openPanel}
        >
          ADMIN
        </button>
      </div>
      <div class="relative mx-auto w-full max-w-[480px] flex-1 px-4 pb-2">
        <div class="pointer-events-none absolute inset-x-[26px] bottom-0 top-8 rounded-[26px] border border-[#eae4d6] bg-[#f3eee1]" />
        <div class="pointer-events-none absolute inset-x-4 bottom-6 top-2 flex flex-col overflow-hidden rounded-[26px] border border-[#e6e0d2] bg-[#fffefa]">
          <div class="flex items-baseline justify-between px-6 pt-5">
            <span class="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a9b3a9]">{typeLabel}</span>
            <span class="shrink-0 pl-3 text-[12px] tracking-[0.3em] text-[#b6c0b5]">{kanjiNext}</span>
          </div>
          <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6">
            <p class={sentenceClass(loaded.value)}>{nextCard}</p>
          </div>
          <div class="flex-1 px-6 pb-6 pt-4" />
        </div>
        <div
          data-testid="card"
          class="absolute inset-x-4 bottom-6 top-2 flex touch-none flex-col overflow-hidden rounded-[26px] border border-[#e6e0d2] bg-[#fffefa] shadow-[0_24px_60px_-28px_rgba(41,67,49,0.45)]"
          style={{
            transform: `translateX(${dragX.value}px) rotate(${dragX.value / 26}deg)`,
            transition: transition.value,
            opacity: fading.value ? 0 : 1,
          }}
          onTouchStart$={$((event: TouchEvent) => {
            const t = event.touches[0];
            startX.value = t.clientX;
            startY.value = t.clientY;
            dragging.value = true;
            transition.value = "none";
          })}
          onTouchMove$={$((event: TouchEvent) => {
            if (!dragging.value) return;
            dragX.value = event.touches[0].clientX - startX.value;
          })}
          onTouchEnd$={$((event: TouchEvent) => {
            const t = event.changedTouches[0];
            void finish(t.clientX - startX.value, t.clientY - startY.value);
          })}
          onTouchCancel$={$(() => {
            dragging.value = false;
            transition.value = EASE;
            dragX.value = 0;
          })}
          onPointerDown$={$((event: PointerEvent) => {
            if (event.pointerType !== "mouse") return;
            startX.value = event.clientX;
            startY.value = event.clientY;
            dragging.value = true;
            transition.value = "none";
          })}
          onPointerMove$={$((event: PointerEvent) => {
            if (event.pointerType !== "mouse" || !dragging.value) return;
            dragX.value = event.clientX - startX.value;
          })}
          onPointerUp$={$((event: PointerEvent) => {
            if (event.pointerType !== "mouse") return;
            void finish(event.clientX - startX.value, event.clientY - startY.value);
          })}
        >
          <div class="flex items-baseline justify-between px-6 pt-5">
            <span class="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a9b3a9]">{typeLabel}</span>
            <span class="shrink-0 pl-3 text-[12px] tracking-[0.3em] text-[#b6c0b5]">{kanjiNow}</span>
          </div>
          <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6">
            <p data-testid="sentence" class={sentenceClass(loaded.value)} lang="ja">
              {reveal.value >= 1 && info
                ? info.parts.flatMap((part, i) =>
                    unitsFor(part.text, part.kana).map((unit, j) => (
                      <span
                        key={`${i}-${j}`}
                        class={
                          "inline-flex max-w-full flex-col items-center align-bottom" +
                          (reveal.value >= 2 ? ` ${PART_BG[i % 5]} rounded-[3px] px-0.5` : "")
                        }
                      >
                        <span
                          class={
                            unit.whole
                              ? "flex w-full justify-between whitespace-nowrap font-sans text-[0.34em] leading-[1.25] text-[#6c8a76]"
                              : "whitespace-nowrap font-sans text-[0.34em] leading-[1.25] text-[#6c8a76]"
                          }
                        >
                          {unit.whole && unit.reading
                            ? [...unit.reading].map((c, k) => <span key={k}>{c}</span>)
                            : unit.reading || "\u00a0"}
                        </span>
                        <span class="leading-[1.3]">{unit.text}</span>
                      </span>
                    )),
                  )
                : card}
            </p>
          </div>
          <div
            class={
              "min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 " +
              (reveal.value >= 2 && info ? "border-t border-[#e3ded2]" : "")
            }
          >
            {reveal.value >= 2 && info && (
              <>
                <p class="m-0 mb-3 text-center text-[15px] leading-normal text-[#3a4a40]">{info[language.value]}</p>
                <ul class="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {info.parts.map((part, i) => (
                    <li key={i} class={`rounded-[3px] px-2 py-1 text-[13px] leading-snug text-[#5b6a60] ${PART_BG[i % 5]}`}>
                      <b class="font-semibold text-[#22322a]">{part.text}</b> <span>{part[language.value]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
      <nav class="flex justify-center gap-1.5 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
        {(["en", "vi", "ja"] as const).map((lang) => (
          <button
            key={lang}
            class={
              language.value === lang
                ? "rounded-full bg-[#2f5d45] px-[18px] py-2.5 text-[11px] font-bold tracking-[0.12em] text-[#f7f4ec]"
                : "rounded-full bg-transparent px-[18px] py-2.5 text-[11px] font-bold tracking-[0.12em] text-[#9aa79d]"
            }
            onClick$={() => (language.value = lang)}
          >
            {lang === "en" ? "EN" : lang === "vi" ? "VN" : "JP"}
          </button>
        ))}
      </nav>

      {topicDone.value && (
        <div class="fixed inset-0 z-40 flex items-center justify-center bg-[#f7f4ec]/95 px-6">
          <div class="w-full max-w-[340px] text-center">
            <div class="text-[10px] font-bold tracking-[0.22em] text-[#a0aaa1]">TOPIC COMPLETE</div>
            <div class="mt-3 text-[24px] font-semibold text-[#22322a]">{topicList.find((t) => t.id === topic.value)?.label ?? ""}</div>
            <button
              class="mt-7 w-full rounded-full bg-[#2f5d45] py-3 text-[13px] font-semibold text-[#f7f4ec]"
              onClick$={() => {
                const at = topicList.findIndex((t) => t.id === topic.value);
                const next = topicList[(at + 1) % topicList.length];
                topic.value = next.id;
                const first = topicSequences[next.id]?.[0];
                if (first !== undefined) index.value = first;
                reveal.value = 0;
                topicDone.value = false;
              }}
            >
              Next topic
            </button>
            <button
              class="mt-2 w-full rounded-full border border-[#e0dbcd] py-3 text-[13px] font-semibold text-[#6d7c71]"
              onClick$={() => (topicDone.value = false)}
            >
              Stay here
            </button>
            <button class="mt-3 text-[12px] text-[#8f9c92] underline" onClick$={openPanel}>
              Pick another topic
            </button>
          </div>
        </div>
      )}

      {lessonDone.value && (
        <div class="fixed inset-0 z-40 flex items-center justify-center bg-[#f7f4ec]/95 px-6">
          <div class="w-full max-w-[340px] text-center">
            <div class="text-[10px] font-bold tracking-[0.22em] text-[#a0aaa1]">LESSON COMPLETE</div>
            <div class="mt-3 text-[26px] font-semibold text-[#22322a]">{lessonAt(index.value).label}</div>
            <div class="mt-1 text-[13px] text-[#7c8b80]">{lessonAt(index.value).count} cards</div>
            <button
              class="mt-7 w-full rounded-full bg-[#2f5d45] py-3 text-[13px] font-semibold text-[#f7f4ec]"
              onClick$={() => {
                const at = lessons.findIndex((lesson) => lesson.id === lessonAt(index.value).id);
                const next = lessons[Math.min(lessons.length - 1, at + 1)];
                index.value = next.start;
                reveal.value = 0;
                lessonDone.value = false;
              }}
            >
              Next lesson
            </button>
            <button
              class="mt-2 w-full rounded-full border border-[#e0dbcd] py-3 text-[13px] font-semibold text-[#6d7c71]"
              onClick$={() => (lessonDone.value = false)}
            >
              Review again
            </button>
            <button class="mt-3 text-[12px] text-[#8f9c92] underline" onClick$={openPanel}>
              Pick another lesson
            </button>
          </div>
        </div>
      )}

      {panelOpen.value && (
        <div class="fixed inset-0 z-50 flex items-end justify-center bg-[#1f2a24]/30" onClick$={() => (panelOpen.value = false)}>
          <div
            class="w-full max-w-[480px] rounded-t-[20px] bg-[#fffefa] px-5 pt-4 pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgba(30,45,35,0.18)]"
            onClick$={(event: MouseEvent) => event.stopPropagation()}
          >
            <div class="mb-4 flex items-center justify-between">
              <span class="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#7c8b80]">Admin</span>
              <button
                class="rounded-full bg-[#f1ede1] px-4 py-2 text-[12px] font-semibold text-[#4d5d52] active:bg-[#e8e3d4]"
                onClick$={() => (panelOpen.value = false)}
              >
                Close
              </button>
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between gap-3 py-1.5">
                <span class="text-[12px] text-[#8f9c92]">View</span>
                <div class="flex items-center rounded-[10px] bg-[#f4f0e4]">
                  <button class="h-10 w-9 text-[15px] text-[#8f9c92]" onClick$={() => cycleMode(-1)} aria-label="Previous view">
                    ‹
                  </button>
                  <button class="min-w-[104px] px-1 text-center text-[13px] font-medium text-[#22322a]" onClick$={() => (picker.value = "view")}>
                    {mode.value === "lesson" ? "Lessons" : mode.value === "topic" ? "Topics" : mode.value === "group" ? "Kanji" : "Random"}
                  </button>
                  <button class="h-10 w-9 text-[15px] text-[#8f9c92]" onClick$={() => cycleMode(1)} aria-label="Next view">
                    ›
                  </button>
                </div>
              </div>

              <div class="flex items-center justify-between gap-3 py-1.5">
                <span class="text-[12px] text-[#8f9c92]">{mode.value === "topic" ? "Topic" : "Lesson"}</span>
                <div class="flex items-center rounded-[10px] bg-[#f4f0e4]">
                  <button
                    class="h-10 w-9 text-[15px] text-[#8f9c92]"
                    onClick$={() => (mode.value === "topic" ? cycleTopic(-1) : cycleLesson(-1))}
                    aria-label="Previous"
                  >
                    ‹
                  </button>
                  <button
                    class="min-w-[104px] px-1 text-center text-[13px] font-medium text-[#22322a]"
                    onClick$={() => (picker.value = mode.value === "topic" ? "topic" : "lesson")}
                  >
                    {mode.value === "topic"
                      ? topicList.find((t) => t.id === topic.value)?.label ?? ""
                      : lessonAt(index.value).label}
                  </button>
                  <button
                    class="h-10 w-9 text-[15px] text-[#8f9c92]"
                    onClick$={() => (mode.value === "topic" ? cycleTopic(1) : cycleLesson(1))}
                    aria-label="Next"
                  >
                    ›
                  </button>
                </div>
              </div>

              <div class="flex items-center justify-between gap-3 py-1.5">
                <span class="text-[12px] text-[#8f9c92]">History</span>
                <button
                  class="flex w-[176px] items-center justify-between rounded-[10px] bg-[#f4f0e4] px-4 py-2.5 text-[13px] font-medium text-[#22322a]"
                  onClick$={() => (picker.value = "history")}
                >
                  {historyTotal.value} visits
                  <span class="text-[15px] text-[#8f9c92]">›</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {picker.value && (
        <div class="fixed inset-0 z-[60] flex items-end justify-center bg-[#1f2a24]/40" onClick$={() => (picker.value = null)}>
          <div
            class="flex max-h-[74dvh] w-full max-w-[480px] flex-col rounded-t-[20px] bg-[#fffefa] px-5 pt-4 pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgba(30,45,35,0.2)]"
            onClick$={(event: MouseEvent) => event.stopPropagation()}
          >
            <div class="mb-3 flex items-center justify-between">
              <span class="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#7c8b80]">
                {picker.value === "view" ? "View" : picker.value === "history" ? "History" : "Jump to"}
              </span>
              <button
                class="rounded-full bg-[#f1ede1] px-4 py-2 text-[12px] font-semibold text-[#4d5d52] active:bg-[#e8e3d4]"
                onClick$={() => (picker.value = null)}
              >
                Close
              </button>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto pb-2 [mask-image:linear-gradient(to_bottom,black_90%,transparent)]">
              {picker.value === "view" &&
                ([
                  ["lesson", "Lessons", "Walk a lesson end to end"],
                  ["topic", "Topics", "Follow one theme across the book"],
                  ["group", "Kanji", "Straight through the kanji order"],
                  ["random", "Random", "Any card, no order"],
                ] as const).map(([value, label, hint]) => (
                  <button
                    key={value}
                    class={
                      "flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left " +
                      (mode.value === value ? "bg-[#e6efe6]" : "")
                    }
                    onClick$={() => {
                      mode.value = value;
                      picker.value = null;
                    }}
                  >
                    <span class="text-[13px] font-medium text-[#22322a]">{label}</span>
                    <span class="text-[11px] text-[#a6b0a6]">{hint}</span>
                  </button>
                ))}

              {picker.value === "lesson" &&
                lessons.map((lesson) => (
                  <button
                    key={lesson.id}
                    class={
                      "flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left " +
                      (lesson.id === lessonAt(index.value).id ? "bg-[#e6efe6]" : "")
                    }
                    onClick$={() => {
                      void jumpToLesson(lesson);
                      picker.value = null;
                    }}
                  >
                    <span class="text-[13px] font-medium text-[#22322a]">{lesson.label}</span>
                    <span class="text-[11px] tabular-nums text-[#a6b0a6]">{lesson.count}</span>
                  </button>
                ))}

              {picker.value === "topic" &&
                topicList.map((item) => (
                  <button
                    key={item.id}
                    class={
                      "flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left " +
                      (item.id === topic.value ? "bg-[#e6efe6]" : "")
                    }
                    onClick$={() => {
                      void jumpToTopic(item.id);
                      picker.value = null;
                    }}
                  >
                    <span class="text-[13px] font-medium text-[#22322a]">{item.label}</span>
                    <span class="text-[11px] tabular-nums text-[#a6b0a6]">{item.count}</span>
                  </button>
                ))}

              {picker.value === "history" && (
                <>
                  {history.value.length === 0 && <div class="py-4 text-[13px] text-[#a6b0a6]">Nothing yet.</div>}
                  {history.value.map((visit, i) => (
                    <div key={i} class="flex items-baseline gap-3 py-2">
                      <span class="w-11 shrink-0 text-[11px] tabular-nums text-[#a6b0a6]">
                        {new Date(visit.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span class="w-4 shrink-0 text-[12px] text-[#8f9c92]">{cardKanji[visit.index] ?? ""}</span>
                      <span class="min-w-0 flex-1 truncate text-[13px] text-[#4d5d52]">{cards[visit.index]}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
});

export const head: DocumentHead = {
  title: "N1 GOI",
  meta: [{ name: "description", content: "One card at a time." }],
};