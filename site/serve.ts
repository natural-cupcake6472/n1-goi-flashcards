const PORT = 4177;
const KV_HOST = "127.0.0.1";
const KV_PORT = 6666;
const STATE_KEY = "n1goi:state";
const HISTORY_KEY = (mode: string) => `n1goi:history:${mode}`;
const COUNTS_KEY = (mode: string) => `n1goi:counts:${mode}`;

type Resp = string | number | null | Resp[] | Error;

function encode(args: string[]): string {
  return `*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("");
}

function parse(buf: string): { value: Resp; rest: string } | null {
  if (!buf.length) return null;
  const end = buf.indexOf("\r\n");
  if (end < 0) return null;
  const type = buf[0];
  const line = buf.slice(1, end);
  const rest = buf.slice(end + 2);
  if (type === "+") return { value: line, rest };
  if (type === "-") return { value: new Error(line), rest };
  if (type === ":") return { value: Number(line), rest };
  if (type === "$") {
    const len = Number(line);
    if (len < 0) return { value: null, rest };
    if (rest.length < len + 2) return null;
    return { value: rest.slice(0, len), rest: rest.slice(len + 2) };
  }
  if (type === "*") {
    const count = Number(line);
    if (count < 0) return { value: null, rest };
    const items: Resp[] = [];
    let cursor = rest;
    for (let i = 0; i < count; i++) {
      const parsed = parse(cursor);
      if (!parsed) return null;
      items.push(parsed.value);
      cursor = parsed.rest;
    }
    return { value: items, rest: cursor };
  }
  return null;
}

/** One command per connection; the state endpoint is hit a few times per session. */
async function kv(args: string[]): Promise<Resp> {
  return await new Promise<Resp>((resolve, reject) => {
    let buf = "";
    let settled = false;
    const done = (value: Resp) => {
      if (settled) return;
      settled = true;
      if (value instanceof Error) reject(value);
      else resolve(value);
    };
    Bun.connect({
      hostname: KV_HOST,
      port: KV_PORT,
      socket: {
        open(socket) {
          socket.write(encode(args));
        },
        data(socket, chunk) {
          buf += chunk.toString();
          const parsed = parse(buf);
          if (!parsed) return;
          done(parsed.value);
          socket.end();
        },
        error(_socket, error) {
          done(error as Error);
        },
        close() {
          if (!settled) done(null);
        },
      },
    }).catch((error) => done(error as Error));
  });
}

async function readState(): Promise<State> {
  const reply = await kv(["HMGET", STATE_KEY, "index", "reveal", "lang", "mode", "topic"]);
  const values = Array.isArray(reply) ? (reply as string[]) : [];
  const index = Number(values[0]);
  const reveal = Number(values[1]);
  return {
    index: Number.isFinite(index) ? index : 0,
    reveal: Number.isFinite(reveal) ? reveal : 0,
    lang: values[2] ?? "en",
    mode: isMode(values[3]) ? values[3] : "lesson",
    topic: values[4] ?? "",
  };
}

async function writeState(state: State) {
  await kv([
    "HSET",
    STATE_KEY,
    "index",
    String(state.index),
    "reveal",
    String(state.reveal),
    "lang",
    state.lang,
    "mode",
    state.mode,
    "topic",
    state.topic,
  ]);
}

type Mode = "lesson" | "topic" | "group" | "random";
type State = { index: number; reveal: number; lang: string; mode: Mode; topic: string };
const isMode = (value: unknown): value is Mode =>
  value === "lesson" || value === "topic" || value === "group" || value === "random";

/** A visit is a card change, not every tap: taps only change the reveal stage. */
async function applyState(state: State) {
  const previous = await readState();
  await writeState(state);
  if (previous.index === state.index) return;
  const ts = Date.now();
  await kv(["ZADD", HISTORY_KEY(state.mode), String(ts), `${state.index}|${state.reveal}|${state.lang}|${ts}`]);
  await kv(["HINCRBY", COUNTS_KEY(state.mode), String(state.index), "1"]);
}

async function readHistory(limit: number, mode: Mode) {
  const flat = (await kv(["ZREVRANGE", HISTORY_KEY(mode), "0", String(limit - 1), "WITHSCORES"])) as string[] | null;
  const entries: { index: number; reveal: number; lang: string; at: number }[] = [];
  if (Array.isArray(flat)) {
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const [index, reveal, lang, ts] = String(flat[i]).split("|");
      entries.push({ index: Number(index), reveal: Number(reveal), lang, at: Number(ts) });
    }
  }
  const total = Number(await kv(["ZCARD", HISTORY_KEY(mode)])) || 0;
  const pairs = (await kv(["HGETALL", COUNTS_KEY(mode)])) as string[] | null;
  const counts: Record<string, number> = {};
  if (Array.isArray(pairs)) {
    for (let i = 0; i + 1 < pairs.length; i += 2) counts[String(pairs[i])] = Number(pairs[i + 1]);
  }
  return { total, entries, counts };
}

const json = (body: string) =>
  new Response(body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });

type Client = { send: (data: string) => void };

const clients = new Set<Client>();

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  websocket: {
    async open(ws) {
      clients.add(ws as unknown as Client);
      try {
        (ws as unknown as Client).send(JSON.stringify({ type: "state", ...(await readState()) }));
      } catch {
        /* kvrocks down: client keeps its local state */
      }
    },
    close(ws) {
      clients.delete(ws as unknown as Client);
    },
    async message(ws, raw) {
      let msg: { type?: string; index?: unknown; reveal?: unknown; lang?: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "hello") {
        try {
          (ws as unknown as Client).send(JSON.stringify({ type: "state", ...(await readState()) }));
        } catch {
          /* ignore */
        }
        return;
      }
      if (msg.type !== "state") return;
      if (typeof msg.index !== "number" || typeof msg.reveal !== "number" || !["en", "vi", "ja"].includes(String(msg.lang))) return;
      const state: State = {
        index: msg.index,
        reveal: msg.reveal,
        lang: String(msg.lang),
        mode: isMode(msg.mode) ? msg.mode : "lesson",
        topic: typeof msg.topic === "string" ? msg.topic : "",
      };
      try {
        await applyState(state);
      } catch {
        /* ignore write failures; the client keeps its own copy */
      }
      const payload = JSON.stringify({ type: "state", ...state });
      for (const client of clients) {
        if (client !== (ws as unknown as Client)) client.send(payload);
      }
    },
  },
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (srv.upgrade(req)) return undefined;
      return new Response("expected websocket", { status: 400 });
    }
    if (url.pathname === "/api/state") {
      try {
        if (req.method === "GET") return json(JSON.stringify(await readState()));
        if (req.method === "POST") {
          const body = await req.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            return new Response("bad json", { status: 400 });
          }
          const state = parsed as { index?: unknown; reveal?: unknown; lang?: unknown; mode?: unknown; topic?: unknown };
          if (
            typeof state.index !== "number" ||
            typeof state.reveal !== "number" ||
            !["en", "vi", "ja"].includes(String(state.lang))
          ) {
            return new Response("bad state", { status: 400 });
          }
          await applyState({
            index: state.index,
            reveal: state.reveal,
            lang: String(state.lang),
            mode: isMode(state.mode) ? state.mode : "lesson",
            topic: typeof state.topic === "string" ? state.topic : "",
          });
          return json('{"ok":true}');
        }
        return new Response("method not allowed", { status: 405 });
      } catch (error) {
        return json(JSON.stringify({ error: String(error) }));
      }
    }
    if (url.pathname === "/api/history") {
      try {
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
        const requested = url.searchParams.get("mode");
        const mode: Mode = isMode(requested) ? requested : "lesson";
        return json(JSON.stringify(await readHistory(limit, mode)));
      } catch (error) {
        return json(JSON.stringify({ error: String(error) }));
      }
    }
    const path = decodeURIComponent(url.pathname);
    if (path.includes("..")) return new Response("Bad request", { status: 400 });
    const file = Bun.file(new URL("./dist" + (path === "/" ? "/index.html" : path), import.meta.url));
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});
console.log(`serving ${PORT}, state in kvrocks ${KV_HOST}:${KV_PORT}/${STATE_KEY}`);