const PORT = 4177;

// Static host only: the app keeps its state in localStorage.
Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (path.includes("..")) return new Response("Bad request", { status: 400 });
    const file = Bun.file(new URL("./dist" + (path === "/" ? "/index.html" : path), import.meta.url));
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});
console.log("serving " + PORT + " (static)");
