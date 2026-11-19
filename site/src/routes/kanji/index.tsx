import { $, component$, useSignal, useTask$, useVisibleTask$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import deck from "../../generated/deck.json";
import type { KnowledgeEntry } from "../../generated/knowledge-loader";
import furiganaMap from "../../generated/furigana.json";
import kanjiMap from "../../generated/kanji.json";
import lessonOrder from "../../generated/lesson-order.json";
import topicsData from "../../generated/topics.json";
import hanvietMap from "../../generated/hanviet.json";
import kanjiComponents from "../../generated/kanji-components.json";
import kanjiMeaning from "../../generated/kanji-meaning.json";
import lessonKanji from "../../generated/lesson-kanji.json";

const SITE_ID: string = "kanji";

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
const HANVIET = hanvietMap as Record<string, string>;
const COMPONENTS = kanjiComponents as Record<string, { c: string; hv: string; gloss: string }[]>;
const MEANING = kanjiMeaning as Record<string, string>;
const LESSON_KANJI = lessonKanji as Record<string, string[]>;
const hanvietForText = (text: string): string =>
  [...new Set([...text].filter((c) => /\p{Script=Han}/u.test(c)))]
    .map((c) => HANVIET[c] ?? "")
    .filter(Boolean)
    .join(" ");
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
const IDB_NAME = "n1goi";
const openDb = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("kv")) request.result.createObjectStore("kv");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
const idbPut = async (key: string, value: unknown) => {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
};
const idbGet = async <T,>(key: string): Promise<T | null> => {
  const db = await openDb();
  if (!db) return null;
  const value = await new Promise<T | null>((resolve) => {
    const tx = db.transaction("kv", "readonly");
    const request = tx.objectStore("kv").get(key);
    request.onsuccess = () => resolve((request.result ?? null) as T | null);
    request.onerror = () => resolve(null);
  });
  db.close();
  return value;
};
const BACK_KEY = "n1goi:back";
const readBack = (): number[] => {
  try {
    return JSON.parse(localStorage.getItem(BACK_KEY) ?? "[]") as number[];
  } catch {
    return [];
  }
};
const writeBack = (stack: number[]) => {
  try {
    localStorage.setItem(BACK_KEY, JSON.stringify(stack.slice(-100)));
  } catch {
    /* ignore */
  }
};
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

const uid = (): string => "main";

const copyText = (text: string) => {
  // navigator.clipboard needs a secure context; LAN http falls back to execCommand
  const fallback = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      document.execCommand("copy");
      ta.remove();
    } catch { /* ignore */ }
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(fallback);
  } else {
    fallback();
  }
};


const pullToday = async (): Promise<number> => {
  try {
    const r = await fetch("/api/state?deck=kanji&u=" + encodeURIComponent(uid()), { cache: "no-store" });
    if (!r.ok) return 0;
    const j = (await r.json()) as { today?: number };
    return Number(j.today ?? 0);
  } catch {
    return 0;
  }
};

const todayIndices = (): number[] => {
  try {
    const midnight = studyDayStart();
    const seen = new Set<number>();
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("n1goi:history:")) continue;
      const list = JSON.parse(localStorage.getItem(key) ?? "[]") as Visit[];
      for (const v of list) if (v.at >= midnight) seen.add(v.index);
    }
    return [...seen];
  } catch {
    return [];
  }
};

const pushVisits = async (indices: number[]): Promise<number> => {
  try {
    const r = await fetch("/api/visits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deck: "kanji", indices }),
    });
    if (!r.ok) return 0;
    const j = (await r.json()) as { today?: number };
    return Number(j.today ?? 0);
  } catch {
    return 0;
  }
};

const pullState = async (): Promise<Stored | null> => {
  try {
    const r = await fetch("/api/state?deck=kanji&u=" + encodeURIComponent(uid()), { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { state?: Stored | null };
    return j.state ?? null;
  } catch {
    return null;
  }
};

let pushTimer: ReturnType<typeof setTimeout> | null = null;
const pushState = (state: Stored): Promise<number> =>
  new Promise((resolve) => {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      fetch("/api/state?deck=kanji&u=" + encodeURIComponent(uid()), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { today?: number } | null) => resolve(Number(j?.today ?? 0)))
        .catch(() => resolve(0));
    }, 400);
  });

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

const studyDayStart = (): number => {
  const d = new Date();
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  d.setHours(5, 0, 0, 0);
  return d.getTime();
};

const studyDayKey = (): string => {
  const d = new Date(Date.now() - 5 * 3600 * 1000);
  return d.toLocaleDateString("en-CA");
};

const readToday = (): number => {
  try {
    const midnight = studyDayStart();
    const seen = new Set<number>();
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("n1goi:history:")) continue;
      const list = JSON.parse(localStorage.getItem(key) ?? "[]") as Visit[];
      for (const visit of list) if (visit.at >= midnight) seen.add(visit.index);
    }
    return seen.size;
  } catch {
    return 0;
  }
};

const KANJI_RE = /[\u4e00-\u9fff]/;
const DAILY_GOAL = 474;
const PART_BG = ["bg-[#e0efe4]", "bg-[#f8e9d6]", "bg-[#e4e8f7]", "bg-[#f6e2e5]", "bg-[#e5eee7]"];
const SWIPE = 80;
const EASE = "transform 200ms ease-out";

export default component$(() => {
  const index = useSignal(0);
  const reveal = useSignal(0);
  const revealFor = useSignal(0);
  const language = useSignal<"en" | "vi" | "ja">("en");
  const mode = useSignal<Mode>("lesson");
  const topic = useSignal<string>(topicList[0]?.id ?? "");
  const detail = useSignal<KnowledgeEntry | undefined>(undefined);
  const detailFor = useSignal<number>(-1);
  const previewDetail = useSignal<KnowledgeEntry | undefined>(undefined);
  const dragX = useSignal(0);
  const dragging = useSignal(false);
  const openKanji = useSignal<string | null>(null);
  const ignoreGesture = useSignal(false);
  const fading = useSignal(false);
  const fly = useSignal<"" | "left" | "right">("");
  const transition = useSignal("none");
  const startX = useSignal(0);
  const startY = useSignal(0);
  const loaded = useSignal(false);
  const panelOpen = useSignal(false);
  const zoom = useSignal(1);
  const setZoom = $((delta: number) => {
    zoom.value = Math.min(1.6, Math.max(0.8, Math.round((zoom.value + delta) * 10) / 10));
    try { localStorage.setItem("n1goi:zoom", String(zoom.value)); } catch { /* ignore */ }
  });
  const copied = useSignal(false);
  const intro = useSignal(false);
  const lessonDone = useSignal(false);
  const topicDone = useSignal(false);
  const picker = useSignal<"view" | "lesson" | "topic" | "history" | null>(null);
  const history = useSignal<Visit[]>([]);
  const historyTotal = useSignal(0);
  const todayCount = useSignal(0);
  const remote = useSignal(false);
  const lastVisit = useSignal(-1);
  const lastPushed = useSignal("");
  const backStack = useSignal<number[]>([]);

  useTask$(async ({ track }) => {
    const current = track(() => index.value);
    const japanese = cards[current];
    if (!japanese) return;
    openKanji.value = null;
    const { loadChunk } = await import("../../generated/knowledge-loader");
    let chunk: Record<string, KnowledgeEntry> | undefined;
    if (detailFor.value !== current) {
      chunk = await loadChunk(deckIndex(current));
      if (index.value !== current) return;
      detail.value = chunk?.[japanese];
      detailFor.value = current;
    }
    const previewPosition = nextPosition(current, -1, mode.value, topic.value) ?? (current + 1) % cards.length;
    const previewChunk = chunk ?? (await loadChunk(deckIndex(previewPosition)));
    if (index.value !== current) return;
    previewDetail.value = previewChunk?.[cards[previewPosition]];
    for (const offset of [1, 2, 3, 4, 5]) {
      const target =
        mode.value === "topic"
          ? topicSequences[topic.value]?.[(topicSequences[topic.value] ?? []).indexOf(current) + offset]
          : (current + offset) % cards.length;
      if (target === undefined) continue;
      void loadChunk(deckIndex(target)).catch(() => undefined);
    }
  });

  // Local state only: localStorage first, IndexedDB as the fallback.
  useVisibleTask$(async () => {
    void navigator.storage?.persist?.().catch(() => undefined);
    const stored = readState() ?? (await idbGet<Stored>("state"));
    if (stored) {
      if (stored.index >= 0 && stored.index < cards.length) index.value = stored.index;
      reveal.value = Math.min(2, Math.max(0, stored.reveal ?? 0));
      if (stored.lang) language.value = stored.lang;
      if (stored.mode) mode.value = stored.mode;
      if (stored.topic && topicSequences[stored.topic]) topic.value = stored.topic;
    }
    const remoteToday = await pullToday();
    const localIdx = todayIndices();
    if (localIdx.length) {
      const merged = await pushVisits(localIdx);
      if (merged) todayCount.value = merged;
      else if (remoteToday > 0) todayCount.value = remoteToday;
    } else if (remoteToday > 0) {
      todayCount.value = remoteToday;
    }
    const remote = await pullState();
    if (remote) {
      if (typeof remote.index === "number" && remote.index >= 0 && remote.index < cards.length) index.value = remote.index;
      if (typeof remote.reveal === "number") reveal.value = Math.min(2, Math.max(0, remote.reveal));
      if (remote.lang) language.value = remote.lang;
      if (remote.mode) mode.value = remote.mode;
      if (remote.topic && topicSequences[remote.topic]) topic.value = remote.topic;
    }
    history.value = readHistory(mode.value);
    historyTotal.value = history.value.length;
    backStack.value = readBack();
    try {
      const day = studyDayKey();
      const cached = Number(localStorage.getItem("n1goi:today:" + day) || 0);
      const local = readToday();
      const server = todayCount.value;
      todayCount.value = server > 0 ? Math.max(server, local) : Math.max(cached, local);
      localStorage.setItem("n1goi:today:" + day, String(todayCount.value));
    } catch { /* ignore */ }
    try {
      const savedZoom = Number(localStorage.getItem("n1goi:zoom"));
      if (savedZoom >= 0.8 && savedZoom <= 1.6) zoom.value = savedZoom;
    } catch { /* ignore */ }
    loaded.value = true;
    if (!remote) {
      pushState({ index: index.value, reveal: reveal.value, lang: language.value, mode: mode.value, topic: topic.value });
    }
  });

  // Persist locally.
  useTask$(({ track }) => {
    const ready = track(() => loaded.value);
    const card = track(() => index.value);
    const step = track(() => reveal.value);
    const stageCard = track(() => revealFor.value);
    const lang = track(() => language.value);
    const order = track(() => mode.value);
    const currentTopic = track(() => topic.value);
    if (!ready || typeof window === "undefined") return;
    const stage = stageCard === card ? step : 0;
    const snapshot = { index: card, reveal: stage, lang, mode: order, topic: currentTopic };
    writeState(snapshot);
    const serialized = JSON.stringify({ ...snapshot, reveal: 0 });
    if (serialized !== lastPushed.value) {
      lastPushed.value = serialized;
      void pushState(snapshot).then((n) => { if (n > todayCount.value) todayCount.value = n; });
    }
    if (lastVisit.value !== card) lastVisit.value = card;
    void idbPut("state", snapshot);
    if (!remote.value) {
      history.value = pushHistory(order, card);
      historyTotal.value = history.value.length;
      todayCount.value = Math.max(todayCount.value, readToday());
      try {
        const day = studyDayKey();
        localStorage.setItem("n1goi:today:" + day, String(todayCount.value));
      } catch { /* ignore */ }
    }
    remote.value = false;
  });

  const finish = $((dx: number, dy: number) => {
    dragging.value = false;
    const isSwipe = Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.2;
    if (!isSwipe) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        reveal.value = (reveal.value + 1) % 3;
        revealFor.value = index.value;
      }
      transition.value = EASE;
      dragX.value = 0;
      return;
    }

    // Both directions advance: the deck only moves forward, the card always leaves to the left.
    const total = cards.length;
    let destination: { kind: "card"; index: number } | { kind: "end"; which: "lesson" | "topic" } | null = null;
    if (mode.value === "random") {
      const next = Math.floor(Math.random() * total);
      destination = { kind: "card", index: next === index.value ? (next + 1) % total : next };
    } else if (mode.value === "topic") {
      const sequence = topicSequences[topic.value] ?? [];
      const at = sequence.indexOf(index.value);
      const target = at < 0 ? undefined : sequence[at + 1];
      if (target !== undefined) destination = { kind: "card", index: target };
      else destination = { kind: "end", which: "topic" };
    } else if (mode.value === "lesson") {
      const lesson = lessonAt(index.value);
      const next = index.value + 1;
      if (next >= lesson.start + lesson.count) destination = { kind: "end", which: "lesson" };
      else destination = { kind: "card", index: next };
    } else {
      destination = { kind: "card", index: (index.value + 1) % total };
    }

    transition.value = "none";
    fly.value = Math.sign(dx) < 0 ? "left" : "right";
    fading.value = true;
    setTimeout(() => {
      if (!fading.value) return;
      if (destination.kind === "card") {
        const target = destination.index;
        backStack.value = [...backStack.value, index.value].slice(-100);
        writeBack(backStack.value);
        index.value = target;
        reveal.value = 0;
        transition.value = "none";
        fly.value = "";
        dragX.value = 0;
        fading.value = false;
      } else {
        transition.value = "none";
        fly.value = "";
        dragX.value = 0;
        fading.value = false;
        reveal.value = 0;
        if (destination.which === "topic") topicDone.value = true;
        else lessonDone.value = true;
      }
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
    intro.value = true;
  });
  const cycleTopic = $((dir: number) => {
    const at = topicList.findIndex((item) => item.id === topic.value);
    const next = topicList[(at + dir + topicList.length) % topicList.length];
    topic.value = next.id;
    const first = topicSequences[next.id]?.[0];
    if (first !== undefined) index.value = first;
    backStack.value = [];
    writeBack([]);
    mode.value = "topic";
    reveal.value = 0;
    topicDone.value = false;
  });
  const jumpToLesson = $((lesson: Lesson) => {
    index.value = lesson.start;
    backStack.value = [];
    writeBack([]);
    reveal.value = 0;
    lessonDone.value = false;
  });
  const jumpToTopic = $((id: string) => {
    topic.value = id;
    const first = topicSequences[id]?.[0];
    if (first !== undefined) index.value = first;
    backStack.value = [];
    writeBack([]);
    mode.value = "topic";
    reveal.value = 0;
    topicDone.value = false;
  });
  const goBack = $(() => {
    const stack = backStack.value;
    if (!stack.length) return;
    const previous = stack[stack.length - 1];
    backStack.value = stack.slice(0, -1);
    writeBack(backStack.value);
    index.value = previous;
    reveal.value = 0;
    dragX.value = 0;
    lessonDone.value = false;
    topicDone.value = false;
  });

  // Browser/hardware back steps a card instead of leaving the app.
  useVisibleTask$(({ cleanup }) => {
    window.history.pushState({ n1goi: true }, "", location.href);
    const onPop = () => {
      void goBack();
      window.history.pushState({ n1goi: true }, "", location.href);
    };
    window.addEventListener("popstate", onPop);
    cleanup(() => window.removeEventListener("popstate", onPop));
  });

  const clearHistory = $(() => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("n1goi:history:")) localStorage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
    history.value = [];
    historyTotal.value = 0;
  });

  const openPanel = $(() => {
    panelOpen.value = true;
    history.value = readHistory(mode.value);
    historyTotal.value = history.value.length;
  });

  const shown = revealFor.value === index.value ? reveal.value : 0;
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
  const currentLesson = lessonAt(index.value);
  const topicSeqNow = topicSequences[topic.value] ?? [];
  const topicPos = topicSeqNow.indexOf(index.value);
  const progress =
    mode.value === "lesson"
      ? { done: index.value - currentLesson.start + 1, total: currentLesson.count }
      : mode.value === "topic"
        ? { done: topicPos + 1, total: topicSeqNow.length }
        : null;
  const progressPct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const visited = new Set(history.value.map((visit) => visit.index));
  const groupIndices = (item: Lesson | Topic): number[] =>
    "start" in item
      ? Array.from({ length: item.count }, (_, k) => item.start + k)
      : topicSequences[item.id] ?? [];

  const sentenceClass = (isLoaded: boolean) =>
    `m-0 text-center font-serif text-[clamp(20px,5.8vw,29px)] leading-[1.9] [text-wrap:balance] transition-opacity duration-150 ${isLoaded ? "opacity-100" : "opacity-0"}`;

  return (
    <main class="fixed inset-0 flex select-none flex-col bg-[#f7f4ec] text-[#1f2a24]" style={{ zoom: zoom.value }}>
      <div class="flex h-10 items-center justify-between px-5">
        <button
          aria-label="Back"
          class="flex h-8 w-8 items-center justify-center rounded-full border border-[#ddd8c9] text-[14px] text-[#7c8b80] disabled:opacity-30 active:bg-[#ece7d9]"
          disabled={backStack.value.length === 0}
          onClick$={goBack}
        >
          ↩
        </button>
        <div class="flex items-center gap-1">
          <button
            aria-label="Kanji deck"
            class={"rounded-full px-2 py-1.5 text-[10px] font-bold tracking-[0.14em] " + (SITE_ID === "kanji" ? "border border-[#cfe0d2] bg-[#e6efe6] text-[#2f5d45]" : "border border-[#ddd8c9] text-[#7c8b80]")}
            onClick$={() => { window.location.href = "/kanji/"; }}
          >
            漢
          </button>
          <button
            aria-label="Goi deck"
            class={"rounded-full px-2 py-1.5 text-[10px] font-bold tracking-[0.14em] " + (SITE_ID === "goi" ? "border border-[#cfe0d2] bg-[#e6efe6] text-[#2f5d45]" : "border border-[#ddd8c9] text-[#7c8b80]")}
            onClick$={() => { window.location.href = "/goi/"; }}
          >
            語
          </button>
          <button
            aria-label="Grammar deck"
            class={"rounded-full px-2 py-1.5 text-[10px] font-bold tracking-[0.14em] " + (SITE_ID === "grammar" ? "border border-[#cfe0d2] bg-[#e6efe6] text-[#2f5d45]" : "border border-[#ddd8c9] text-[#7c8b80]")}
            onClick$={() => { window.location.href = "/grammar/"; }}
          >
            文
          </button>
          <button
            aria-label="Admin panel"
            class="rounded-full border border-[#ddd8c9] px-3 py-1.5 text-[10px] font-bold tracking-[0.16em] text-[#7c8b80] active:bg-[#ece7d9]"
            onClick$={openPanel}
          >
            ADMIN
          </button>
        </div>
      </div>
      <div class="mx-auto w-full max-w-[480px] px-5 pb-2">
        <div class="flex items-center gap-2">
          <div class="h-[3px] flex-1 overflow-hidden rounded-full bg-[#e6e2d4]">
            <div
              class="h-full rounded-full bg-[#7fa98c] transition-[width] duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {progress && (
            <span class="text-[10px] tabular-nums text-[#a6b0a6]">
              {progress.done}/{progress.total}
            </span>
          )}
          <span class="text-[10px] text-[#c3cbc0]">·</span>
          <span class="text-[10px] tabular-nums text-[#a6b0a6]">
            {Math.max(0, DAILY_GOAL - todayCount.value)} 🎯
          </span>
        </div>
      </div>
      <div class="relative mx-auto w-full max-w-[480px] flex-1 px-4 pb-2">
        <div
          class={
            "pointer-events-none absolute inset-x-4 bottom-6 top-2 flex flex-col overflow-hidden rounded-[26px] border border-[#e6e0d2] bg-[#fffefa] shadow-[0_24px_60px_-28px_rgba(41,67,49,0.45)]"
          }
        >
          <div class="flex items-center justify-between px-6 pt-5">
            <span class="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a9b3a9]">{typeLabel}</span>
            <span class="flex shrink-0 items-center gap-1.5 pl-3 leading-none">
                          <button
              data-no-tap
              aria-label="Copy sentence"
              onTouchStart$={$((e: TouchEvent) => e.stopPropagation())}
              onPointerDown$={$((e: PointerEvent) => e.stopPropagation())}
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#a9b3a9] transition-colors active:bg-[#ece7d9] active:text-[#5f6f66]"
              onClick$={$(() => {
                copyText(nextCard);
                copied.value = true;
                setTimeout(() => (copied.value = false), 1200);
              })}
            >
              {copied.value ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              )}
            </button>
              <span class="text-[12px] tracking-[0.3em] text-[#b6c0b5]">{kanjiNext}</span>
            </span>
          </div>
          <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6">
            <p class={sentenceClass(loaded.value)} lang="ja">
              {previewDetail.value
                ? previewDetail.value.parts.flatMap((part, i) =>
                    unitsFor(part.text, part.kana).map((unit, j) => (
                      <span key={`${i}-${j}`} class="inline-flex max-w-full flex-col items-center rounded-[3px] px-0.5 align-bottom">
                        <span
                          class={
                            (unit.whole ? "flex w-full justify-between whitespace-nowrap" : "whitespace-nowrap") +
                            " font-sans text-[0.34em] leading-[1.25] text-[#6c8a76] opacity-0"
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
                : nextCard}
            </p>
          </div>
          <div class="flex-1 px-6 pb-6 pt-4" />
        </div>
        <div
          data-build="2026-11-20T00:45" data-testid="card"
          class={
            "absolute inset-x-4 bottom-6 top-2 flex touch-none flex-col overflow-hidden rounded-[26px] border border-[#e6e0d2] bg-[#fffefa] shadow-[0_24px_60px_-28px_rgba(41,67,49,0.45)] " +
            (fly.value === "left" ? "fly-left" : fly.value === "right" ? "fly-right" : "")
          }
          style={{
            transform: `translate3d(${dragX.value}px, 0, 0) rotate(${dragX.value / 26}deg)`,
            transition: transition.value,
            willChange: "transform",
            contain: "layout paint",
          }}
          onTouchStart$={$((event: TouchEvent) => {
            if (openKanji.value) {
              ignoreGesture.value = true;
              return;
            }
            const hit = document.elementFromPoint(event.touches[0].clientX, event.touches[0].clientY);
            if (hit?.closest("[data-no-tap]")) {
              ignoreGesture.value = true;
              return;
            }
            ignoreGesture.value = false;
            const t = event.touches[0];
            startX.value = t.clientX;
            startY.value = t.clientY;
            dragging.value = false;
          })}
          onTouchMove$={$((event: TouchEvent) => {
            if (openKanji.value) return;
            if (ignoreGesture.value) return;
            const dx = event.touches[0].clientX - startX.value;
            const dy = event.touches[0].clientY - startY.value;
            if (!dragging.value) {
              if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
              dragging.value = true;
              transition.value = "none";
            }
            dragX.value = Math.max(-220, Math.min(220, dx));
          })}
          onTouchEnd$={$((event: TouchEvent) => {
            if (openKanji.value) {
              ignoreGesture.value = false;
              dragging.value = false;
              dragX.value = 0;
              return;
            }
            if (ignoreGesture.value) {
              ignoreGesture.value = false;
              return;
            }
            const t = event.changedTouches[0];
            const dx = t.clientX - startX.value;
            const dy = t.clientY - startY.value;
            if (!dragging.value) {
              if (Math.abs(dx) < 10 && Math.abs(dy) < 10) void finish(dx, dy);
              return;
            }
            void finish(dx, dy);
          })}
          onTouchCancel$={$(() => {
            dragging.value = false;
            transition.value = EASE;
            dragX.value = 0;
          })}
          onPointerDown$={$((event: PointerEvent) => {
            if (openKanji.value || event.pointerType !== "mouse") return;
            startX.value = event.clientX;
            startY.value = event.clientY;
            dragging.value = true;
            transition.value = "none";
          })}
          onPointerMove$={$((event: PointerEvent) => {
            if (openKanji.value || event.pointerType !== "mouse" || !dragging.value) return;
            dragX.value = event.clientX - startX.value;
          })}
          onPointerUp$={$((event: PointerEvent) => {
            if (openKanji.value) {
              dragging.value = false;
              dragX.value = 0;
              return;
            }
            if (event.pointerType !== "mouse") return;
            void finish(event.clientX - startX.value, event.clientY - startY.value);
          })}
        >
          <div class="flex items-center justify-between px-6 pt-5">
            <span class="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a9b3a9]">{typeLabel}</span>
            <span class="flex shrink-0 items-center gap-1.5 pl-3 leading-none">
                        <button
              data-no-tap
              aria-label="Copy sentence"
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#a9b3a9] transition-colors active:bg-[#ece7d9] active:text-[#5f6f66]"
              onClick$={$((e: MouseEvent) => {
                e.stopPropagation();
                copyText(card);
                copied.value = true;
                setTimeout(() => (copied.value = false), 1200);
              })}
            >
              {copied.value ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              )}
            </button>
            <span class="text-[12px] tracking-[0.3em] text-[#b6c0b5]">{kanjiNow}</span>
          </span>
          </div>
          <div class="relative flex flex-1 flex-col items-center justify-center gap-2 px-6">
            <p data-testid="sentence" class={sentenceClass(loaded.value)} lang="ja">
              {info
                ? info.parts.flatMap((part, i) =>
                    unitsFor(part.text, part.kana).map((unit, j) => (
                      <span
                        key={`${i}-${j}`}
                        class={
                          "inline-flex max-w-full flex-col items-center rounded-[3px] px-0.5 align-bottom" +
                          (shown >= 2 ? ` ${PART_BG[i % 5]}` : "")
                        }
                      >
                        <span
                          class={
                            (unit.whole
                              ? "flex w-full justify-between whitespace-nowrap"
                              : "whitespace-nowrap") +
                            " font-sans text-[0.34em] leading-[1.25] text-[#6c8a76] " +
                            (shown >= 1 ? "opacity-100" : "opacity-0")
                          }
                        >
                          {unit.whole && unit.reading
                            ? [...unit.reading].map((c, k) => <span key={k}>{c}</span>)
                            : unit.reading || "\u00a0"}
                        </span>
                        <span class="leading-[1.3]">
                          {shown >= 1 && info
                            ? [...unit.text].map((ch, k) =>
                                /[\u4e00-\u9fff]/.test(ch) ? (
                                  <button
                                    key={k}
                                    data-no-tap
                                    tabIndex={-1}
                                    aria-label={"Kanji " + ch}
                                    onTouchStart$={$((e: TouchEvent) => e.stopPropagation())}
                                    onTouchEnd$={$((e: TouchEvent) => e.stopPropagation())}
                                    onPointerDown$={$((e: PointerEvent) => e.stopPropagation())}
                                    onPointerUp$={$((e: PointerEvent) => e.stopPropagation())}
                                    onClick$={$((e: MouseEvent) => {
                                      e.stopPropagation();
                                      openKanji.value = openKanji.value === ch ? null : ch;
                                    })}
                                    class={
                                      "inline appearance-none border-0 bg-transparent p-0 font-[inherit] leading-[inherit] text-[inherit] " +
                                      (openKanji.value === ch
                                        ? "border-b-2 border-[#8fb79a]"
                                        : "border-b border-dotted border-[#c3cbc1]")
                                    }
                                  >
                                    {ch}
                                  </button>
                                ) : (
                                  <span key={k}>{ch}</span>
                                ),
                              )
                            : unit.text}
                        </span>
                      </span>
                    )),
                  )
                : card}
            </p>
            {shown >= 1 && info && openKanji.value && (
              <div class="pointer-events-none absolute inset-x-3 top-full z-50 -mt-3">
                <div data-no-tap class="n1-pop pointer-events-auto mx-auto w-[min(94%,24rem)] overflow-hidden rounded-[10px] border border-[#e6e0d2] bg-[#fffdf6] shadow-[0_14px_32px_-20px_rgba(41,67,49,0.45)]">
                  {(() => {
                    const ch = openKanji.value as string;
                    const parts = COMPONENTS[ch] ?? [];
                    const word = info.parts.find((item) => item.text.includes(ch));
                    return (
                      <>
                        <div class="flex items-center gap-2.5 px-3 py-1.5">
                          <span class="font-serif text-[22px] leading-none text-[#22322a]">{ch}</span>
                          <span class="min-w-0 flex-1">
                            <span class="block text-[9px] uppercase tracking-[0.1em] text-[#8fa094]">{HANVIET[ch] ?? ""}</span>
                            <span class="block text-[11px] leading-tight text-[#3a4a40]">{MEANING[ch] ?? ""}</span>
                          </span>
                          <button
                            aria-label="Close kanji"
                            onTouchStart$={$((e: TouchEvent) => e.stopPropagation())}
                            onTouchEnd$={$((e: TouchEvent) => e.stopPropagation())}
                            onPointerDown$={$((e: PointerEvent) => e.stopPropagation())}
                            onClick$={$((e: MouseEvent) => {
                              e.stopPropagation();
                              openKanji.value = null;
                            })}
                            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[14px] leading-none text-[#8fa094] active:bg-[#ece7d9]"
                          >
                            ×
                          </button>
                        </div>
                        <div class="border-t border-[#efeadb] px-3 py-1.5">
                          <div class="flex flex-wrap items-center gap-1">
                            {parts.length ? (
                              parts.map((part) => (
                                <span class="inline-flex items-baseline gap-0.5 rounded-[4px] bg-[#f1efe4] px-1 py-0.5">
                                  <span class="font-serif text-[13px] leading-none text-[#22322a]">{part.c}</span>
                                  {part.hv && <span class="text-[8px] uppercase tracking-[0.05em] text-[#8fa094]">{part.hv}</span>}
                                  {part.gloss && <span class="text-[9px] leading-none text-[#6d7c71]">{part.gloss}</span>}
                                </span>
                              ))
                            ) : (
                              <span class="text-[10px] text-[#a6b0a6]">không tách được bộ</span>
                            )}
                          </div>
                          {parts.length > 0 && (
                            <div class="mt-1 text-[10px] leading-tight text-[#6d7c71]">
                              {parts.map((part) => part.c + (part.gloss ? " (" + part.gloss + ")" : "")).join(" + ")}
                              {" → " + ch + " " + (HANVIET[ch] ?? "")}
                            </div>
                          )}
                          {word && (
                            <div class="text-[10px] leading-tight text-[#8fa094]">
                              {"trong " + word.text + (word.kana ? " (" + word.kana + ")" : "") + " — " + word.vi}
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
          <div
            class={
              "min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 " +
              (shown >= 2 && info ? "sheet-in border-t border-[#e3ded2]" : "")
            }
          >
            {shown >= 2 && info && (
              <>
                <p class="m-0 mb-3 text-center text-[15px] leading-normal text-[#3a4a40]">
                  {info[language.value]}
                </p>
                <ul class="m-0 grid list-none grid-cols-[max-content_max-content_1fr] items-baseline gap-x-3 gap-y-2 p-0">
                  {info.parts.map((part, i) => (
                    <li key={i} class="contents">
                      <span
                        class={`justify-self-start rounded-[3px] px-1.5 py-0.5 text-[13px] font-semibold text-[#22322a] ${PART_BG[i % 5]}`}
                      >
                        {part.text}
                      </span>
                      <span class="text-[13px] text-[#8fa094]">
                        {KANJI_RE.test(part.text) && part.kana && part.kana !== part.text ? part.kana : ""}
                      </span>
                      <span class="text-[13px] leading-snug text-[#4d5d52]">
                        {language.value === "vi" && hanvietForText(part.text) && (
                          <span class="mr-1.5 text-[10px] uppercase tracking-[0.06em] text-[#8fa094]">
                            {hanvietForText(part.text)}
                          </span>
                        )}
                        {part[language.value]}
                      </span>
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

      {intro.value && (
        <div class="fixed inset-0 z-40 flex items-center justify-center bg-[#f7f4ec] px-6">
          <div class="relative w-full max-w-[340px]">
            <div class="text-[10px] font-bold tracking-[0.22em] text-[#a0aaa1]">
              {mode.value === "topic" ? "TOPIC" : "LESSON"}
            </div>
            <div class="mt-2 text-[26px] font-semibold text-[#22322a]">
              {mode.value === "topic"
                ? topicList.find((t) => t.id === topic.value)?.label ?? ""
                : lessonAt(index.value).label}
            </div>
            <div class="mt-1 text-[13px] text-[#7c8b80]">
              {mode.value === "topic"
                ? (topicSequences[topic.value]?.length ?? 0) + " cards"
                : lessonAt(index.value).count + " cards · " + (LESSON_KANJI[lessonAt(index.value).id]?.length ?? 0) + " kanji"}
            </div>
            {mode.value !== "topic" && (LESSON_KANJI[lessonAt(index.value).id]?.length ?? 0) > 0 && (
              <div class="mt-5 flex flex-wrap gap-x-2.5 gap-y-1.5 text-[17px] text-[#3d4f44]">
                {(LESSON_KANJI[lessonAt(index.value).id] ?? []).map((kanji) => (
                  <span key={kanji}>{kanji}</span>
                ))}
              </div>
            )}
            <button
              class="mt-8 w-full rounded-full bg-[#2f5d45] py-3 text-[13px] font-semibold text-[#f7f4ec]"
              onClick$={() => (intro.value = false)}
            >
              Start
            </button>
          </div>
        </div>
      )}

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
    backStack.value = [];
    writeBack([]);
                reveal.value = 0;
                topicDone.value = false;
              }}
            >
              Next topic
            </button>
            <button
              class="mt-2 w-full rounded-full border border-[#e0dbcd] py-3 text-[13px] font-semibold text-[#6d7c71]"
              onClick$={() => {
                const first = topicSequences[topic.value]?.[0];
                if (first !== undefined) index.value = first;
                reveal.value = 0;
                revealFor.value = first ?? index.value;
                topicDone.value = false;
              }}
            >
              Restart topic
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
              onClick$={() => {
                const start = lessonAt(index.value).start;
                index.value = start;
                reveal.value = 0;
                revealFor.value = start;
                lessonDone.value = false;
              }}
            >
              Restart lesson
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
              <span class="text-[12px] text-[#8f9c92]">Zoom</span>
              <div class="flex items-center rounded-[10px] bg-[#f4f0e4]">
                <button class="h-10 w-9 text-[15px] text-[#8f9c92]" onClick$={() => setZoom(-0.1)} aria-label="Zoom out">−</button>
                <span class="min-w-[56px] text-center text-[13px] font-medium text-[#22322a]">{Math.round(zoom.value * 100)}%</span>
                <button class="h-10 w-9 text-[15px] text-[#8f9c92]" onClick$={() => setZoom(0.1)} aria-label="Zoom in">+</button>
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
                  <div class="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a9b3a9]">Progress</div>
                  <div class="mb-4">
                    {(mode.value === "topic" ? topicList : lessons).map((item) => {
                      const indices = groupIndices(item);
                      const seen = indices.filter((i) => visited.has(i)).length;
                      const pct = indices.length ? Math.round((seen / indices.length) * 100) : 0;
                      return (
                        <div key={item.id} class="py-1.5">
                          <div class="mb-1 flex items-baseline justify-between">
                            <span class="text-[12px] text-[#4d5d52]">{item.label}</span>
                            <span class="text-[10px] tabular-nums text-[#a6b0a6]">
                              {seen}/{indices.length}
                            </span>
                          </div>
                          <div class="h-[3px] overflow-hidden rounded-full bg-[#eef0e9]">
                            <div class="h-full rounded-full bg-[#7fa98c]" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a9b3a9]">Recent</div>
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
                  <button
                    class="mt-2 w-full rounded-[10px] bg-[#f7efec] px-3 py-3 text-[12px] font-semibold text-[#a45334] active:bg-[#f2e6e1]"
                    onClick$={clearHistory}
                  >
                    Clear history
                  </button>
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