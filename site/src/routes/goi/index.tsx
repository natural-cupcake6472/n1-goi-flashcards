import { component$, useSignal, useTask$, useVisibleTask$, $ } from "@builder.io/qwik";
import goiData from "../../generated/goi-cards.json";

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
const STORE = "n1goi-goi:state";
const UID_KEY = "n1goi:uid";

const uid = (): string => {
  try {
    let v = localStorage.getItem(UID_KEY);
    if (!v) {
      v = (crypto as Crypto).randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
      localStorage.setItem(UID_KEY, v);
    }
    return v;
  } catch {
    return "anon";
  }
};

const pullState = async (): Promise<Record<string, unknown> | null> => {
  try {
    const r = await fetch("/api/state?deck=goi&u=" + encodeURIComponent(uid()), { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { state?: Record<string, unknown> | null };
    return j.state ?? null;
  } catch {
    return null;
  }
};

let pushTimer: ReturnType<typeof setTimeout> | null = null;
const pushState = (state: Record<string, unknown>) => {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void fetch("/api/state?deck=goi&u=" + encodeURIComponent(uid()), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    }).catch(() => undefined);
  }, 400);
};


export default component$(() => {
  const lesson = useSignal(0);
  const index = useSignal(0);
  const stage = useSignal(0);
  const dragX = useSignal(0);
  const dragging = useSignal(false);
  const startX = useSignal(0);
  const startY = useSignal(0);
  const transition = useSignal("transform 200ms ease-out");
  const fading = useSignal(false);
  const panelOpen = useSignal(false);

  const current = LESSONS[lesson.value];
  const cards = current.cards;
  const card = cards[index.value];

  const synced = useSignal(false);

  useVisibleTask$(async () => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.lesson === "number" && s.lesson < LESSONS.length) lesson.value = s.lesson;
        if (typeof s.index === "number" && s.index < LESSONS[lesson.value].cards.length) index.value = s.index;
      }
    } catch { /* ignore */ }
    const remote = await pullState();
    if (remote) {
      if (typeof remote.lesson === "number" && remote.lesson < LESSONS.length) lesson.value = remote.lesson;
      if (typeof remote.index === "number") index.value = Math.min(remote.index as number, LESSONS[lesson.value].cards.length - 1);
    }
    synced.value = true;
    if (!remote) pushState({ lesson: lesson.value, index: index.value });
  });

  useTask$(({ track }) => {
    const l = track(() => lesson.value);
    const i = track(() => index.value);
    if (typeof window === "undefined") return;
    localStorage.setItem(STORE, JSON.stringify({ lesson: l, index: i }));
    if (synced.value) pushState({ lesson: l, index: i });
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
          data-testid="card"
          class="absolute inset-x-4 bottom-6 top-2 flex touch-none flex-col overflow-hidden rounded-[26px] border border-[#e6e0d2] bg-[#fffefa] shadow-[0_24px_60px_-28px_rgba(41,67,49,0.45)]"
          style={{
            transform: `translateX(${dragX.value}px) rotate(${dragX.value / 26}deg)`,
            transition: transition.value,
            opacity: fading.value ? 0 : 1,
          }}
          onTouchStart$={$((e: TouchEvent) => {
            const t = e.touches[0];
            startX.value = t.clientX;
            startY.value = t.clientY;
            dragging.value = true;
            transition.value = "none";
          })}
          onTouchMove$={$((e: TouchEvent) => {
            if (!dragging.value) return;
            dragX.value = e.touches[0].clientX - startX.value;
          })}
          onTouchEnd$={$((e: TouchEvent) => {
            const t = e.changedTouches[0];
            void finish(t.clientX - startX.value, t.clientY - startY.value);
          })}
        >
          <div class="flex items-baseline justify-between px-6 pt-5">
            <span class="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a9b3a9]">
              {current.label} · {current.buoi}
            </span>
            <span class="text-[10px] tabular-nums text-[#b6c0b5]">{String(index.value + 1).padStart(2, "0")}</span>
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