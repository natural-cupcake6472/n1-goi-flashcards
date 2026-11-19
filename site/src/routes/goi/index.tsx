import { component$, useSignal, useTask$, useVisibleTask$, $ } from "@builder.io/qwik";
import goiData from "../../generated/goi-cards.json";
import hanvietMap from "../../generated/hanviet.json";

const SITE_ID: string = "goi";

type Part = { text: string; reading?: string };
type Card = {
  word: string;
  reading: string;
  hanviet: string;
  meaning_vi: string;
  meaning_ja: string;
  example: { ja: string; vi: string; parts: Part[] };
};
type Lesson = { id: string; label: string; buoi: string; cards: Card[] };

const LESSONS = (goiData as unknown as { lessons: Lesson[] }).lessons;
const HANVIET = hanvietMap as Record<string, string>;
const KANJI_RE = /[\u4e00-\u9fff]/;
const STORE = "n1goi-goi:state";
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



export default component$(() => {
  const lesson = useSignal(0);
  const index = useSignal(0);
  const stage = useSignal(0);
  const dragX = useSignal(0);
  const dragging = useSignal(false);
  const ignoreGesture = useSignal(false);
  const startX = useSignal(0);
  const startY = useSignal(0);
  const transition = useSignal("transform 200ms ease-out");
  const fading = useSignal(false);
  const panelOpen = useSignal(false);
  const copied = useSignal(false);

  const current = LESSONS[lesson.value];
  const cards = current.cards;
  const card = cards[index.value];

  useVisibleTask$(async () => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.lesson === "number" && s.lesson < LESSONS.length) lesson.value = s.lesson;
        if (typeof s.index === "number" && s.index < LESSONS[lesson.value].cards.length) index.value = s.index;
      }
    } catch { /* ignore */ }
  });

  useTask$(({ track }) => {
    const l = track(() => lesson.value);
    const i = track(() => index.value);
    if (typeof window === "undefined") return;
    localStorage.setItem(STORE, JSON.stringify({ lesson: l, index: i }));
  });

  const advance = $((dir: number) => {
    const next = index.value + dir;
    if (next >= cards.length) index.value = 0;
    else if (next < 0) index.value = cards.length - 1;
    else index.value = next;
    stage.value = 0;
  });

  const finish = $((dx: number, dy: number) => {
    dragging.value = false;
    const isSwipe = Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.2;
    transition.value = "transform 200ms ease-out";
    if (!isSwipe) {
      dragX.value = 0;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) stage.value = (stage.value + 1) % 3;
      return;
    }
    dragX.value = Math.sign(dx) * 620;
    fading.value = true;
    setTimeout(() => {
      transition.value = "none";
      dragX.value = 0;
      fading.value = false;
      void advance(1);
    }, 200);
  });

  const progress = { done: index.value + 1, total: cards.length };
  const pct = Math.round((progress.done / progress.total) * 100);

  return (
    <main class="fixed inset-0 flex flex-col bg-[#f7f4ec] text-[#2b3a31]">
      <div class="mx-auto flex w-full max-w-[480px] items-center justify-between px-5 pt-[max(12px,env(safe-area-inset-top))]">
        <button
          aria-label="Back to kanji deck"
          class="flex h-9 w-9 items-center justify-center rounded-full border border-[#e6e0d2] bg-[#fffefa] text-[14px] text-[#7d8c81]"
          onClick$={() => {
            window.location.href = "/kanji/";
          }}
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
            class="rounded-full border border-[#e6e0d2] bg-[#fffefa] px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6d7c71]"
            onClick$={() => (panelOpen.value = true)}
          >
            Admin
          </button>
        </div>
      </div>

      <div class="mx-auto flex w-full max-w-[480px] items-center gap-3 px-5 pt-3">
        <div class="h-[3px] flex-1 overflow-hidden rounded-full bg-[#e6e0d2]">
          <div class="h-full bg-[#3f6b52]" style={{ width: pct + "%" }} />
        </div>
        <span class="text-[10px] tabular-nums text-[#a6b0a6]">{progress.done}/{progress.total}</span>
      </div>

      <div class="relative mx-auto min-h-0 w-full max-w-[480px] flex-1 px-4 pb-2 pt-3">
        <div
          data-build="2026-11-16T21:20" data-testid="card"
          class="absolute inset-x-4 bottom-6 top-2 flex touch-none flex-col overflow-hidden rounded-[26px] border border-[#e6e0d2] bg-[#fffefa] shadow-[0_24px_60px_-28px_rgba(41,67,49,0.45)]"
          style={{
            transform: `translateX(${dragX.value}px) rotate(${dragX.value / 26}deg)`,
            transition: transition.value,
            opacity: fading.value ? 0 : 1,
          }}
          onTouchStart$={$((e: TouchEvent) => {
            const hit = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
            if (hit?.closest("[data-no-tap]")) {
              ignoreGesture.value = true;
              return;
            }
            ignoreGesture.value = false;
            const t = e.touches[0];
            startX.value = t.clientX;
            startY.value = t.clientY;
            dragging.value = false;
          })}
          onTouchMove$={$((e: TouchEvent) => {
            if (ignoreGesture.value || !dragging.value) return;
            dragX.value = e.touches[0].clientX - startX.value;
          })}
          onTouchEnd$={$((e: TouchEvent) => {
            if (ignoreGesture.value) {
              ignoreGesture.value = false;
              return;
            }
            const t = e.changedTouches[0];
            void finish(t.clientX - startX.value, t.clientY - startY.value);
          })}
        >
          <div class="flex items-center justify-between px-6 pt-5">
            <span class="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a9b3a9]">
              {current.label} · {current.buoi}
            </span>
            <span class="flex items-center gap-1.5">
              <button
              data-no-tap
                aria-label="Copy word"
                onTouchStart$={$((e: TouchEvent) => e.stopPropagation())}
                onPointerDown$={$((e: PointerEvent) => e.stopPropagation())}
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#a9b3a9] transition-colors active:bg-[#ece7d9] active:text-[#5f6f66]"
                onClick$={$((e: MouseEvent) => {
                  e.stopPropagation();
                  copyText(card.word);
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
              <span class="text-[10px] tabular-nums text-[#b6c0b5]">{String(index.value + 1).padStart(2, "0")}</span>
            </span>
          </div>

          <div class="flex flex-1 flex-col items-center justify-center px-6">
            <div class="text-center">
              <span
                class="block h-4 text-[10px] tracking-[0.06em] text-[#6c8a76]"
                style={{ opacity: stage.value >= 1 ? 1 : 0 }}
              >
                {card.reading}
              </span>
              <span class="block font-serif text-[clamp(22px,6vw,30px)] leading-tight">{card.word}</span>
              <span class="mt-1 block text-[10px] uppercase tracking-[0.14em] text-[#8fa094]">{card.hanviet}</span>
              <span class="mt-2 flex flex-wrap items-center justify-center gap-2">
                {[...card.word].filter((ch) => KANJI_RE.test(ch)).map((ch) => (
                  <span key={ch} class="inline-flex items-baseline gap-1 rounded-[4px] bg-[#f1efe4] px-1.5 py-0.5">
                    <span class="font-serif text-[13px] leading-none">{ch}</span>
                    <span class="text-[9px] uppercase tracking-[0.08em] text-[#8fa094]">{HANVIET[ch] ?? ""}</span>
                  </span>
                ))}
              </span>
              <span
                class="mt-1 block h-5 text-[12px] text-[#2f5d45]"
                style={{ opacity: stage.value >= 2 ? 1 : 0 }}
              >
                {card.meaning_vi}
              </span>
            </div>

            <p
              class="mx-auto mt-5 max-w-full text-center font-serif text-[clamp(14px,4vw,18px)] leading-[2.4]"
              style={{ "--rt": stage.value >= 1 ? "1" : "0" }}
            >
              {card.example.parts.map((part, i) => (
                <ruby key={i}>
                  {part.text}
                  {part.reading ? <rt style={{ opacity: stage.value >= 1 ? 1 : 0 }}>{part.reading}</rt> : null}
                </ruby>
              ))}
            </p>

            <p
              class="mx-auto mt-1 max-w-[30ch] text-center text-[13px] leading-snug text-[#6d7c71]"
              style={{ opacity: stage.value >= 2 ? 1 : 0 }}
            >
              {card.example.vi}
            </p>
            <p
              class="mx-auto mt-2 max-w-[30ch] text-center text-[10px] uppercase tracking-[0.1em] text-[#a9b3a9]"
              style={{ opacity: stage.value >= 2 ? 1 : 0 }}
            >
              {[...card.word]
                .filter((ch) => KANJI_RE.test(ch))
                .map((ch) => ch + " " + (HANVIET[ch] ?? "?"))
                .join("  +  ")}
            </p>
          </div>

          <div class="pb-4 text-center text-[10px] uppercase tracking-[0.18em] text-[#c3cbc0]">
            {stage.value === 2 ? "tap to reset" : stage.value === 1 ? "tap for translation" : "tap for furigana"}
          </div>
        </div>
      </div>

      {panelOpen.value && (
        <div class="fixed inset-0 z-40 flex items-end bg-[#22322a]/20" onClick$={() => (panelOpen.value = false)}>
          <div class="w-full rounded-t-[22px] border-t border-[#e6e0d2] bg-[#f7f4ec] p-5">
            <div class="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#a9b3a9]">Lessons</div>
            {LESSONS.map((l, i) => (
              <button
                key={l.id}
                class={
                  "mb-1 flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left " +
                  (i === lesson.value ? "bg-[#e6efe6]" : "")
                }
                onClick$={() => {
                  lesson.value = i;
                  index.value = 0;
                  stage.value = 0;
                  panelOpen.value = false;
                }}
              >
                <span class="text-[13px] font-medium">{l.label}</span>
                <span class="text-[11px] tabular-nums text-[#a6b0a6]">{l.cards.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
});