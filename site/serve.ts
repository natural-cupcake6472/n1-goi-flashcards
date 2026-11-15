const PORT = 4178;

// Static host only (cloud build): state lives in localStorage.
Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);
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
console.log("cloud site on " + PORT + " (static, localStorage)");