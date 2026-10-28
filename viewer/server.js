#!/usr/bin/env node
// Zero-dependency viewer for claude-seo audit folders ({domain}-audit/).
// Usage: node viewer/server.js [root-dir] [--port 4173]
const http = require("http");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.PORT || 4173);
const rootArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
const ROOT = path.resolve(rootArg || path.join(__dirname, ".."));
const PUBLIC = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

// Resolve `rel` inside `base`, refusing anything that escapes it.
function safeJoin(base, rel) {
  const p = path.resolve(base, "." + path.sep + rel);
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function listAudits() {
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.endsWith("-audit"))
    .filter((d) => fs.existsSync(path.join(ROOT, d.name, "audit-data.json")))
    .map((d) => d.name);
}

function auditDir(name) {
  return listAudits().includes(name) ? path.join(ROOT, name) : null;
}

const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const lsIf = (p, re) => (fs.existsSync(p) ? fs.readdirSync(p).filter((f) => re.test(f)).sort() : []);

// Archived audits are named {domain}-{yyyy-mm-dd}-audit; the live one is {domain}-audit.
const domainOf = (name) => name.replace(/-audit$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");

function auditMeta(name) {
  const dir = path.join(ROOT, name);
  const data = JSON.parse(fs.readFileSync(path.join(dir, "audit-data.json"), "utf8"));
  const report = readIf(path.join(dir, "FULL-AUDIT-REPORT.md")) || "";
  const date =
    (report.match(/Audit date:\s*(\d{4}-\d{2}-\d{2})/) || name.match(/(\d{4}-\d{2}-\d{2})-audit$/) || [])[1] ||
    fs.statSync(path.join(dir, "audit-data.json")).mtime.toISOString().slice(0, 10);
  return {
    name,
    domain: domainOf(name),
    date,
    score: data.summary?.health_score ?? null,
    categories: (data.categories || []).map((c) => ({ name: c.name, score: c.score })),
  };
}

// Newest first; the undated live folder wins a same-day tie.
function listAuditMeta() {
  return listAudits()
    .map(auditMeta)
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.length - b.name.length);
}

function loadAudit(name) {
  const dir = auditDir(name);
  if (!dir) return null;
  const meta = auditMeta(name);
  let progress = readIf(path.join(dir, "progress.json"));
  let carriedFrom = null;
  // No ticks yet: start from the previous audit of the same domain. The client keys ticks
  // by task title, so only tasks that survived into the new plan come back ticked.
  if (!progress) {
    const prev = listAuditMeta().find((m) => m.domain === meta.domain && m.name !== name && m.date <= meta.date);
    progress = prev && readIf(path.join(ROOT, prev.name, "progress.json"));
    if (progress) carriedFrom = prev.name;
  }
  return {
    ...meta,
    carriedFrom,
    data: JSON.parse(fs.readFileSync(path.join(dir, "audit-data.json"), "utf8")),
    report: readIf(path.join(dir, "FULL-AUDIT-REPORT.md")),
    plan: readIf(path.join(dir, "ACTION-PLAN.md")),
    findings: lsIf(path.join(dir, "findings"), /\.(md|json)$/),
    screenshots: lsIf(path.join(dir, "screenshots"), /\.(png|jpe?g|webp)$/i),
    charts: lsIf(path.join(dir, "charts"), /\.(png|jpe?g|webp|svg)$/i),
    pdfs: lsIf(dir, /\.pdf$/i),
    progress: progress ? JSON.parse(progress) : {},
  };
}

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function sendFile(res, file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: "not found" });
  res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  try {
    if (parts[0] === "api") {
      if (parts[1] === "audits" && parts.length === 2) return send(res, 200, listAuditMeta());
      if (parts[1] === "audit" && parts[2]) {
        const dir = auditDir(parts[2]);
        if (!dir) return send(res, 404, { error: "unknown audit" });
        if (parts[3] === "progress" && req.method === "PUT") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const parsed = JSON.parse(body);
              fs.writeFileSync(path.join(dir, "progress.json"), JSON.stringify(parsed, null, 2));
              send(res, 200, { ok: true });
            } catch {
              send(res, 400, { error: "invalid json" });
            }
          });
          return;
        }
        return send(res, 200, loadAudit(parts[2]));
      }
      return send(res, 404, { error: "not found" });
    }

    if (parts[0] === "files" && parts[1]) {
      const dir = auditDir(parts[1]);
      return sendFile(res, dir && safeJoin(dir, parts.slice(2).join("/")));
    }

    return sendFile(res, safeJoin(PUBLIC, parts.length ? parts.join("/") : "index.html"));
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`SEO audit viewer: http://localhost:${PORT}`);
  console.log(`Reading audits from ${ROOT} (${listAudits().join(", ") || "none found"})`);
});
