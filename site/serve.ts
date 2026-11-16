import { store } from "../shared/redis.ts";

const PORT = 4177;
const DECKS = ["kanji", "goi", "grammar"];
const OWNER = "main";

// Progress score used when collapsing per-device states into the shared one.
const score = (deck: string, raw: string): number => {
  try {
    const s = JSON.parse(raw) as { index?: number; lesson?: number };
    const i = Number(s.index ?? 0);
    const l = Number(s.lesson ?? 0);
    return deck === "kanji" ? i : l * 10000 + i;
  } catch {
    return -1;
  }
};

// If the shared key is missing, adopt the most advanced existing state (never deletes anything).
const adoptBiggest = async (deck: string): Promise<string | null> => {
  const db = store();
  const keys = (await db.command("KEYS", "n1goi:" + deck + ":*")) as string[] | null;
  if (!keys || !keys.length) return null;
  let best: { raw: string; score: number } | null = null;
  const deviceKey = /^[0-9a-f-]{20,}$/i;
  for (const k of keys) {
    if (k === "n1goi:" + deck + ":" + OWNER) continue;
    if (!deviceKey.test(k.slice(("n1goi:" + deck + ":").length))) continue;
    const raw = await db.get(k);
    if (!raw) continue;
    const sc = score(deck, raw);
    if (!best || sc > best.score) best = { raw, score: sc };
  }
  if (!best) return null;
  await db.set("n1goi:" + deck + ":" + OWNER, best.raw, 60 * 60 * 24 * 365);
  return best.raw;
};

Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);

    if (path === "/api/visits") {
      try {
        const body = (await req.json()) as { deck?: string; indices?: number[] };
        const deck = String(body.deck || "kanji").replace(/[^a-z]/g, "");
        if (!DECKS.includes(deck)) return new Response("bad deck", { status: 400 });
        const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
        const key = "n1goi:" + deck + ":today:" + day;
        const idx = (body.indices || []).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 5000);
        if (idx.length) {
          await store().command("SADD", key, ...idx.map(String));
          await store().command("EXPIRE", key, String(60 * 60 * 48));
        }
        const n = Number(await store().command("SCARD", key)) || 0;
        return Response.json({ today: n, day, added: idx.length, store: "kvrocks" });
      } catch (err) {
        return Response.json({ error: String(err).slice(0, 140) }, { status: 502 });
      }
    }

    if (path === "/api/visit") {
      const deck = (url.searchParams.get("deck") || "kanji").replace(/[^a-z]/g, "");
      const i = Number(url.searchParams.get("i"));
      if (!DECKS.includes(deck) || !Number.isFinite(i) || i < 0) return new Response("bad visit", { status: 400 });
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
      const key = "n1goi:" + deck + ":today:" + day;
      try {
        await store().command("SADD", key, String(i));
        await store().command("EXPIRE", key, String(60 * 60 * 48));
        const n = Number(await store().command("SCARD", key));
        return Response.json({ today: n, day, store: "kvrocks" });
      } catch (err) {
        return Response.json({ error: String(err).slice(0, 140) }, { status: 502 });
      }
    }

    if (path === "/api/state") {
      const deck = (url.searchParams.get("deck") || "kanji").replace(/[^a-z]/g, "");
      if (!DECKS.includes(deck)) return new Response("bad deck", { status: 400 });
      const key = "n1goi:" + deck + ":" + OWNER;
      try {
        if (req.method === "GET") {
          let raw = await store().get(key);
          if (!raw) raw = await adoptBiggest(deck);
          const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
          let today = 0;
          try {
            today = Number(await store().command("SCARD", "n1goi:" + deck + ":today:" + day)) || 0;
          } catch { /* ignore */ }
          return Response.json({ state: raw ? JSON.parse(raw) : null, today, day, store: "kvrocks" });
        }
        if (req.method === "PUT" || req.method === "POST") {
          const body = (await req.json()) as { state?: unknown };
          await store().set(key, JSON.stringify(body.state ?? body), 60 * 60 * 24 * 365);
          return Response.json({ ok: true, store: "kvrocks" });
        }
        return new Response("method not allowed", { status: 405 });
      } catch (err) {
        return Response.json({ error: String(err).slice(0, 140) }, { status: 502 });
      }
    }

    if (path.includes("..")) return new Response("Bad request", { status: 400 });
    if (path.startsWith("/api/")) return new Response("Not found", { status: 404 });
    let filePath = path === "/" ? "/index.html" : path;
    if (!/\.[a-z0-9]+$/i.test(filePath)) filePath += "/index.html";
    const file = Bun.file(new URL("./dist" + filePath, import.meta.url));
    if (await file.exists()) return new Response(file);
    const fallback = Bun.file(new URL("./dist/index.html", import.meta.url));
    return (await fallback.exists()) ? new Response(fallback) : new Response("Not found", { status: 404 });
  },
});
console.log("n1 site on " + PORT + " (single shared state in kvrocks)");