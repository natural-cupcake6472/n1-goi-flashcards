import { store } from "../shared/redis.ts";

const PORT = 4177;
const DECKS = ["kanji", "goi", "grammar"];

Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);

    if (path === "/api/state") {
      const deck = (url.searchParams.get("deck") || "kanji").replace(/[^a-z]/g, "");
      if (!DECKS.includes(deck)) return new Response("bad deck", { status: 400 });
      const uid = (url.searchParams.get("u") || "anon").replace(/[^\w-]/g, "").slice(0, 64);
      const key = "n1goi:" + deck + ":" + uid;
      try {
        if (req.method === "GET") {
          const raw = await store().get(key);
          return Response.json({ state: raw ? JSON.parse(raw) : null, store: "kvrocks" });
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
    let filePath = path === "/" ? "/index.html" : path;
    if (!/\.[a-z0-9]+$/i.test(filePath)) filePath += "/index.html";
    const file = Bun.file(new URL("./dist" + filePath, import.meta.url));
    if (await file.exists()) return new Response(file);
    const fallback = Bun.file(new URL("./dist/index.html", import.meta.url));
    return (await fallback.exists()) ? new Response(fallback) : new Response("Not found", { status: 404 });
  },
});
console.log("n1 site on " + PORT + " (kanji + goi + grammar, kvrocks state)");
