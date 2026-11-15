import { Redis } from "../shared/redis.ts";

const PORT = 4177;
const NS = "kanji";
let store: Redis | null = null;
const db = () => {
  if (!store) store = new Redis(process.env.REDIS_URL || "");
  return store;
};

Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);

    if (path === "/api/state") {
      const uid = (url.searchParams.get("u") || "anon").replace(/[^\w-]/g, "").slice(0, 64);
      const key = "n1goi:" + NS + ":" + uid;
      try {
        if (req.method === "GET") {
          const raw = await db().get(key);
          return Response.json({ state: raw ? JSON.parse(raw) : null });
        }
        if (req.method === "PUT" || req.method === "POST") {
          const body = (await req.json()) as { state?: unknown };
          await db().set(key, JSON.stringify(body.state ?? body), 60 * 60 * 24 * 365);
          return Response.json({ ok: true });
        }
        return new Response("method not allowed", { status: 405 });
      } catch (err) {
        return Response.json({ error: String(err).slice(0, 120) }, { status: 502 });
      }
    }

    if (path.includes("..")) return new Response("Bad request", { status: 400 });
    const file = Bun.file(new URL("./dist" + (path === "/" ? "/index.html" : path), import.meta.url));
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});
console.log("serving " + PORT + " (" + NS + ", redis-backed state)");
