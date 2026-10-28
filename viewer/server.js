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
// Default: the current directory if it holds audits, else the folder above viewer/.
const hasAudits = (dir) =>
  fs.readdirSync(dir).some((n) => n.endsWith("-audit") && fs.existsSync(path.join(dir, n, "audit-data.json")));
const ROOT = path.resolve(rootArg || (hasAudits(process.cwd()) ? process.cwd() : path.join(__dirname, "..")));
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

// Archived audits are named {domain}-{yyyy-mm-dd}-{hhmm}-audit (older ones lack -{hhmm});
// the live one is {domain}-audit.
const ARCHIVE_RE = /-(\d{4}-\d{2}-\d{2})(?:-(\d{2})(\d{2}))?-audit$/;
const RUN_FILES = ["audit-data.json", "FULL-AUDIT-REPORT.md", "ACTION-PLAN.md"];
const domainOf = (name) => name.replace(ARCHIVE_RE, "").replace(/-audit$/, "");

function auditMeta(name) {
  const dir = path.join(ROOT, name);
  const data = JSON.parse(fs.readFileSync(path.join(dir, "audit-data.json"), "utf8"));
  const report = readIf(path.join(dir, "FULL-AUDIT-REPORT.md")) || "";
  const fromReport = report.match(/Audit date:\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):?(\d{2}))?/);
  const fromName = name.match(ARCHIVE_RE);
  // Live audit: when its output files were last written (the time typed into the report
  // is unreliable). Archived: the stamp in the folder name, which /seo-archive takes from
  // the same file times; older archives without a time fall back to the report's.
  const ran = new Date(
    Math.max(...RUN_FILES.map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f)).map((f) => fs.statSync(f).mtimeMs)),
  );
  const pad = (n) => String(n).padStart(2, "0");
  const ranDate = `${ran.getFullYear()}-${pad(ran.getMonth() + 1)}-${pad(ran.getDate())}`;
  const ranHm = [null, null, pad(ran.getHours()), pad(ran.getMinutes())];
  const date = fromName ? fromName[1] : ranDate;
  const hm = fromName ? (fromName[2] ? fromName : fromReport?.[2] ? fromReport : null) : ranHm;
  return {
    name,
    domain: domainOf(name),
    date,
    time: hm ? `${hm[2]}:${hm[3]}` : "",
    when: hm ? `${date} ${hm[2]}:${hm[3]}` : date,
    live: !fromName,
    score: data.summary?.health_score ?? null,
    categories: (data.categories || []).map((c) => ({ name: c.name, score: c.score })),
  };
}

// Newest first; on the same day the live folder wins, then the later HH:MM.
function listAuditMeta() {
  const all = listAudits().map(auditMeta);
  // A /seo-archive copy of the live audit is the same run until the next audit updates it.
  const liveRuns = new Set(all.filter((m) => m.live).map((m) => `${m.domain} ${m.when}`));
  return all
    .filter((m) => m.live || !liveRuns.has(`${m.domain} ${m.when}`))
    .sort((a, b) => b.date.localeCompare(a.date) || b.live - a.live || b.time.localeCompare(a.time));
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
    const sameDomain = listAuditMeta().filter((m) => m.domain === meta.domain);
    const prev = sameDomain[sameDomain.findIndex((m) => m.name === name) + 1];
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
      if (parts[1] === "root" && parts.length === 2) return send(res, 200, { root: ROOT });
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
