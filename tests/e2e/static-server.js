const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const port = Number(process.argv[2] || process.env.PORT || 8000);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  if (pathname === "/__shutdown" && request.method === "POST") {
    response.writeHead(204);
    response.end(() => setImmediate(shutdown));
    return;
  }
  let filename = pathname === "/" || !path.extname(pathname) ? "index.html" : pathname.replace(/^\//, "");
  const target = path.resolve(root, filename);
  if (!target.startsWith(root) || !fs.existsSync(target)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream" });
  fs.createReadStream(target).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`Test server: http://127.0.0.1:${port}`));

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
