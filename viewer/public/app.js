// SEO audit viewer client. Renders a claude-seo {domain}-audit/ folder served by server.js.
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const md = (s) => (window.marked ? marked.parse(s || "") : `<pre>${esc(s)}</pre>`);
const mdInline = (s) => (window.marked ? marked.parseInline(s || "") : esc(s));

const SEVERITIES = ["Critical", "High", "Medium", "Low", "Info"];
const sevClass = (s) => "sev-" + String(s || "info").toLowerCase();
const sevRank = (s) => {
  const i = SEVERITIES.findIndex((x) => x.toLowerCase() === String(s).toLowerCase());
  return i < 0 ? SEVERITIES.length : i;
};
const sevBadge = (s) => `<span class="sev ${sevClass(s)}">${esc(String(s).toLowerCase())}</span>`;
const scoreColor = (n) => (n >= 80 ? "var(--good)" : n >= 60 ? "var(--warn)" : "var(--bad)");
const prettyName = (f) =>
  f.replace(/\.(md|json)$/, "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bSxo\b/, "SXO").replace(/\bGeo\b/, "GEO");

const state = { audits: [], audit: null, findingsFilter: { sev: new Set(), cat: "", q: "" } };

// ---------- Parsing helpers ----------

// Category weights from the executive-summary table: "| Technical SEO | 22% | 80 | 17.6 |"
function parseWeights(report) {
  const weights = {};
  for (const m of (report || "").matchAll(/^\|\s*([^|*]+?)\s*\|\s*(\d+)%\s*\|/gm)) weights[m[1].trim()] = Number(m[2]);
  return weights;
}
function weightFor(weights, name) {
  const key = Object.keys(weights).find((k) => k.toLowerCase().startsWith(name.toLowerCase().split(" (")[0].split(" /")[0]));
  return key ? weights[key] : null;
}

// ACTION-PLAN.md -> { intro, phases: [{title, time, items: [{num, title, body, sub[]}]}], extra: [{title, body}] }
function parsePlan(text) {
  const out = { intro: "", phases: [], extra: [] };
  let section = null, item = null;
  for (const line of (text || "").split("\n")) {
    const h2 = line.match(/^##\s+(.*)/);
    if (h2) {
      item = null;
      const isPhase = /^phase\b/i.test(h2[1]);
      const tm = h2[1].match(/\(([^)]+)\)\s*$/);
      section = isPhase
        ? { title: h2[1].replace(/\s*\([^)]+\)\s*$/, ""), time: tm ? tm[1] : "", items: [] }
        : { title: h2[1], body: "" };
      (isPhase ? out.phases : out.extra).push(section);
      continue;
    }
    if (/^#\s/.test(line)) continue;
    if (!section) { out.intro += line + "\n"; continue; }
    if (section.items) {
      const num = line.match(/^(\d+)\.\s+(.*)/);
      const sub = line.match(/^\s+[-*]\s+(.*)/);
      if (num) {
        const t = num[2].match(/^\*\*(.+?)\*\*[:.]?\s*(.*)$/);
        item = { num: num[1], title: t ? t[1].replace(/[.:]$/, "") : num[2], body: t ? t[2] : "", sub: [] };
        section.items.push(item);
      } else if (sub && item) item.sub.push(sub[1]);
      else if (item && line.trim()) item.body += " " + line.trim();
    } else section.body += line + "\n";
  }
  return out;
}

function headingsOf(markdown) {
  return [...(markdown || "").matchAll(/^(#{2,3})\s+(.*)$/gm)].map((m) => ({ level: m[1].length, text: m[2].replace(/[*`]/g, "") }));
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Ticks are keyed by normalised task title, so they survive the renumbering of a re-run plan.
const taskKey = (i) => i.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isDone = (i) => Boolean(state.audit.progress.done?.[taskKey(i)]);
const planItems = () => parsePlan(state.audit.plan).phases.flatMap((p) => p.items);

// progress.json from the first viewer version keyed ticks by item number; rekey them by title.
function migrateProgress() {
  const done = state.audit.progress.done || {};
  const numeric = Object.keys(done).filter((k) => /^\d+$/.test(k));
  if (!numeric.length) return false;
  const byNum = Object.fromEntries(planItems().map((i) => [i.num, i]));
  for (const k of numeric) {
    // Numbers carried over from an older audit point at that audit's plan, so they can't be mapped.
    if (byNum[k] && !state.audit.carriedFrom) done[taskKey(byNum[k])] = done[k];
    delete done[k];
  }
  return true;
}

function allFindings() {
  return (state.audit.data.categories || []).flatMap((c) => (c.findings || []).map((f) => ({ ...f, category: c.name })));
}

// Audits of the current domain, oldest first, and the one just before the current audit.
const runsOfDomain = () => state.audits.filter((a) => a.domain === state.audit.domain).slice().reverse();
function previousRun() {
  const runs = runsOfDomain();
  const i = runs.findIndex((r) => r.name === state.audit.name);
  return i > 0 ? runs[i - 1] : null;
}
const catScore = (run, name) => run?.categories.find((c) => c.name === name)?.score;

// ---------- Small visual pieces ----------

function deltaTag(now, before, { suffix = "" } = {}) {
  if (now == null || before == null) return `<span class="num flat">–</span>`;
  const d = now - before;
  if (!d) return `<span class="num flat">±0</span>`;
  return `<span class="num ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}${suffix}</span>`;
}

function sparkline(values, { w = 72, h = 22, color = "var(--accent)" } = {}) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return `<svg class="spark" width="${w}" height="${h}" aria-hidden="true"><line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="var(--border-strong)" stroke-dasharray="2 3"/></svg>`;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => [(i * w) / (v.length - 1), h - 3 - ((x - lo) / span) * (h - 6)]);
  const last = pts[pts.length - 1];
  return `<svg class="spark" width="${w}" height="${h}" aria-hidden="true">
    <polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${color}"/></svg>`;
}

const meter = (pct, color) => `<div class="meter"><span style="width:${Math.max(0, Math.min(100, pct))}%;background:${color}"></span></div>`;
const sectionHead = (title, aside = "") => `<div class="section-head"><h2>${title}</h2>${aside ? `<span class="aside">${aside}</span>` : ""}</div>`;

// ---------- Views ----------

function renderOverview() {
  const { data, report, domain } = state.audit;
  const s = data.summary || {};
  const weights = parseWeights(report);
  const findings = allFindings();
  const count = (sev) => findings.filter((f) => sevRank(f.severity) === sevRank(sev)).length;
  const items = planItems();
  const done = items.filter(isDone).length;
  const prev = previousRun();
  const runs = runsOfDomain();
  const score = s.health_score ?? 0;

  return `
    <div class="eyebrow">overview · ${esc(state.audit.date)}</div>
    <h1 class="page-title">${esc(domain)}</h1>
    <p class="page-sub">${esc(s.business_type || "")}</p>

    <div class="panel kpis">
      <div class="kpi">
        <div class="kpi-label">Health score</div>
        <div class="kpi-row">
          <div>
            <div class="kpi-value" style="color:${scoreColor(score)}">${score}<small>/100</small></div>
            <div class="kpi-foot">${prev ? `${deltaTag(score, prev.score)} <span class="muted">vs ${esc(prev.date)}</span>` : `<span class="flat">first audit</span>`}</div>
          </div>
          ${sparkline(runs.map((r) => r.score), { w: 96, h: 34 })}
        </div>
      </div>
      <a class="kpi" href="#findings?sev=Critical">
        <div class="kpi-label"><span class="dot sev-critical"></span>Critical</div>
        <div class="kpi-value">${count("Critical")}</div>
        <div class="kpi-foot">must fix first</div>
      </a>
      <a class="kpi" href="#findings?sev=High">
        <div class="kpi-label"><span class="dot sev-high"></span>High</div>
        <div class="kpi-value">${count("High")}</div>
        <div class="kpi-foot">${count("Medium")} medium · ${count("Low")} low</div>
      </a>
      <a class="kpi" href="#plan">
        <div class="kpi-label">Action plan</div>
        <div class="kpi-value">${done}<small>/${items.length}</small></div>
        <div class="kpi-foot" style="margin-top:10px">${meter(items.length ? (done / items.length) * 100 : 0, "var(--good)")}</div>
      </a>
    </div>

    ${sectionHead("Categories", prev ? `Δ vs ${esc(prev.date)}` : "weighted score")}
    <div class="panel table-wrap">
      <table class="table">
        <thead><tr>
          <th>Category</th><th class="hide-sm">Weight</th><th>Score</th><th>Δ</th><th class="hide-sm">Trend</th><th class="r hide-sm">Issues</th>
        </tr></thead>
        <tbody>
          ${(data.categories || []).map((c) => {
            const w = weightFor(weights, c.name);
            const open = (c.findings || []).length;
            const worst = (c.findings || []).map((f) => f.severity).sort((a, b) => sevRank(a) - sevRank(b))[0];
            return `<tr data-cat="${esc(c.name)}">
              <td>${esc(c.name)}</td>
              <td class="num muted hide-sm">${w != null ? w + "%" : "–"}</td>
              <td><div class="score-cell"><span class="num" style="min-width:22px">${c.score}</span>${meter(c.score, scoreColor(c.score))}</div></td>
              <td>${deltaTag(c.score, catScore(prev, c.name))}</td>
              <td class="hide-sm">${sparkline(runs.map((r) => catScore(r, c.name)), { color: scoreColor(c.score) })}</td>
              <td class="r hide-sm"><span class="num">${open}</span>${worst ? ` <span class="dot ${sevClass(worst)}" style="margin-left:6px"></span>` : ""}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>

    ${renderHistory(runs)}

    <div class="grid grid-2" style="margin-top:36px">
      <div class="panel">${topList("Top issues", "top", s.top_findings, reportList(report, /top \d+ critical/i))}</div>
      <div class="panel">${topList("Quick wins", "win", s.quick_wins, reportList(report, /top \d+ quick wins/i))}
      </div>
    </div>

    ${(data.action_plan?.phases || []).length ? `
    ${sectionHead("Roadmap")}
    <div class="grid grid-4">
      ${data.action_plan.phases.map((p, i) => `<div class="panel panel-pad">
        <div class="eyebrow">phase ${i + 1} · ${esc(p.timeframe || "")}</div>
        <div style="font-weight:600;margin-bottom:8px">${esc(p.name.replace(/^phase \d+:\s*/i, ""))}</div>
        <ul class="works">${(p.items || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </div>`).join("")}
    </div>` : ""}`;
}

// A numbered list under a report heading, e.g. "### Top 5 quick wins" -> { slug, items: [markdown, …] }.
function reportList(report, headingRe) {
  const lines = (report || "").split("\n");
  const start = lines.findIndex((l) => /^#{2,4}\s/.test(l) && headingRe.test(l));
  if (start < 0) return null;
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,4}\s/.test(line) || /^---\s*$/.test(line)) break;
    const m = line.match(/^\d+\.\s+(.*)/);
    if (m) items.push(m[1]);
    else if (items.length && line.trim()) items[items.length - 1] += " " + line.trim();
  }
  return { slug: slug(lines[start].replace(/^#+\s*/, "").replace(/[*`]/g, "")), items };
}

// The short summary lines from audit-data.json, tickable, each expandable to the report's long version.
// The report lists them in the same order, so items pair up by position.
const tickKey = (prefix, text) => `${prefix}: ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
function topList(title, prefix, items = [], long) {
  const done = state.audit.progress.done || {};
  const keys = items.map((t) => tickKey(prefix, t));
  const n = keys.filter((k) => done[k]).length;
  const paired = long && long.items.length === items.length;
  return `<div class="panel-title">${title} <span class="num muted" style="font-weight:400;margin-left:6px">${n}/${items.length}</span>
      ${long ? `<a href="javascript:void 0" data-report-jump="${long.slug}" class="mono" style="font-size:11px;margin-left:auto">full report →</a>` : ""}</div>
    <ol class="numbered toplist">${items.map((t, i) => `<li class="tl ${done[keys[i]] ? "done" : ""}">
      <input type="checkbox" data-task="${esc(keys[i])}" ${done[keys[i]] ? "checked" : ""} aria-label="Mark done: ${esc(t)}">
      <div>
        <div class="tl-text">${esc(t)}</div>
        ${paired ? `<details class="tl-more"><summary>details</summary><div class="md">${mdInline(long.items[i])}</div></details>` : ""}
      </div>
    </li>`).join("")}</ol>`;
}

// Score trend across every audit folder of this domain (oldest to newest).
function renderHistory(runs) {
  if (runs.length < 2) {
    return `${sectionHead("History")}
      <div class="panel panel-pad muted" style="font-size:13px">One audit so far. Before re-running, archive it with
      <code class="mono" style="color:var(--text)">seo-viewer archive ${esc(state.audit.domain)}</code> and the trend shows up here.</div>`;
  }
  const W = 1000, H = 160, px = 40, py = 28;
  const scores = runs.map((r) => r.score);
  const lo = Math.max(0, Math.min(...scores) - 10), hi = Math.min(100, Math.max(...scores) + 10);
  const x = (i) => px + (i * (W - 2 * px)) / (runs.length - 1);
  const y = (v) => H - py - ((v - lo) / (hi - lo || 1)) * (H - 2 * py);
  const grid = [lo, (lo + hi) / 2, hi].map((v) => `<line x1="${px}" x2="${W - px}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-dasharray="3 4"/>
    <text x="${px - 10}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--faint)">${Math.round(v)}</text>`).join("");
  return `${sectionHead("History", `${runs.length} audits`)}
    <div class="panel panel-pad">
      <svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Health score over time">
        ${grid}
        <polyline points="${runs.map((r, i) => `${x(i)},${y(r.score)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2"/>
        ${runs.map((r, i) => `<g data-audit="${esc(r.name)}" style="cursor:pointer">
          <circle cx="${x(i)}" cy="${y(r.score)}" r="${r.name === state.audit.name ? 6 : 4}" fill="var(--surface)" stroke="${scoreColor(r.score)}" stroke-width="2.5"/>
          <text x="${x(i)}" y="${y(r.score) - 12}" text-anchor="middle" font-size="13" fill="var(--text)">${r.score}</text>
          <text x="${x(i)}" y="${H - 4}" text-anchor="middle" font-size="11" fill="${r.name === state.audit.name ? "var(--text)" : "var(--faint)"}">${esc(r.date)}</text>
        </g>`).join("")}
      </svg>
    </div>`;
}

function renderFindings() {
  const f = state.findingsFilter;
  const cats = state.audit.data.categories || [];
  const q = f.q.toLowerCase();
  const base = allFindings()
    .filter((x) => !f.cat || x.category === f.cat)
    .filter((x) => !q || [x.title, x.description, x.recommendation, x.category].join(" ").toLowerCase().includes(q));
  const items = base.filter((x) => !f.sev.size || f.sev.has(SEVERITIES[sevRank(x.severity)])).sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
  const catInfo = f.cat ? cats.find((c) => c.name === f.cat) : null;
  const n = (v) => base.filter((x) => sevRank(x.severity) === sevRank(v)).length;

  return `
    <div class="eyebrow">findings · audit-data.json</div>
    <h1 class="page-title">Findings</h1>
    <p class="page-sub">Summary findings sorted by severity. The specialist reports in the sidebar hold the full evidence.</p>
    <div class="toolbar">
      <input class="input" id="fq" placeholder="Filter by text" value="${esc(f.q)}">
      <select class="select" id="fcat"><option value="">All categories</option>${cats.map((c) => `<option ${c.name === f.cat ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
    </div>
    <div class="toolbar"><div class="seg">
      ${SEVERITIES.filter((v) => n(v) || f.sev.has(v)).map((v) => `<button class="${f.sev.has(v) ? "on" : ""}" data-sev="${v}"><span class="dot ${sevClass(v)}"></span>${v}<span class="n">${n(v)}</span></button>`).join("")}
    </div></div>
    ${catInfo ? `<div class="panel panel-pad cat-card">
      <div class="phase-head" style="margin:0"><b>${esc(catInfo.name)}</b><span class="num" style="color:${scoreColor(catInfo.score)}">${catInfo.score}/100</span></div>
      <div class="eyebrow" style="margin:10px 0 0">what works</div>
      <ul class="works">${(catInfo.what_works || []).map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
    </div>` : ""}
    <div class="rows">
      ${items.length ? items.map((x) => `<div class="row-item finding">
        <div>${sevBadge(x.severity)}</div>
        <div>
          <div class="f-title">${esc(x.title)}<span class="f-cat">${esc(x.category)}</span></div>
          <div class="f-desc">${esc(x.description)}</div>
        </div>
        ${x.recommendation ? `<div class="f-fix"><span class="tag">fix →</span><span>${esc(x.recommendation)}</span></div>` : ""}
      </div>`).join("") : `<div class="empty">No findings match these filters.</div>`}
    </div>`;
}

function renderPlan() {
  const plan = parsePlan(state.audit.plan);
  if (!plan.phases.length) return `<div class="empty">No ACTION-PLAN.md found in this audit.</div>`;
  const all = plan.phases.flatMap((p) => p.items);
  const n = all.filter(isDone).length;
  const from = state.audit.carriedFrom && state.audits.find((a) => a.name === state.audit.carriedFrom);

  return `
    <div class="eyebrow">action plan · ACTION-PLAN.md</div>
    <h1 class="page-title">Action plan</h1>
    <p class="page-sub">${esc(plan.intro.trim())}</p>
    ${from ? `<p class="note">↳ ticks carried over from the ${esc(from.date)} audit where the task title is unchanged</p>` : ""}
    <div class="panel progress-line">
      <span class="num"><b>${n}</b><span class="muted">/${all.length}</span></span>
      ${meter((n / all.length) * 100, "var(--good)")}
      <span class="save-state" id="saveState">${Math.round((n / all.length) * 100)}% done</span>
    </div>
    ${plan.phases.map((p) => {
      const pd = p.items.filter(isDone).length;
      return `<section class="phase">
        <div class="phase-head"><h2>${esc(p.title)}</h2><span class="pill">${esc(p.time)} · ${pd}/${p.items.length}</span></div>
        <div class="rows">
        ${p.items.map((i) => `<div class="row-item task ${isDone(i) ? "done" : ""}" id="task-${slug(taskKey(i))}">
          <input type="checkbox" data-task="${esc(taskKey(i))}" ${isDone(i) ? "checked" : ""} aria-label="Mark task ${esc(i.num)} done">
          <div>
            <div class="task-title"><span class="task-num">${esc(i.num.padStart(2, "0"))}</span>${mdInline(i.title)}</div>
            ${i.body.trim() ? `<div class="task-body md">${md(i.body.trim())}</div>` : ""}
            ${i.sub.length ? `<details><summary>why · indicators · failure signals (${i.sub.length})</summary><ul>${i.sub.map((s) => `<li>${mdInline(s)}</li>`).join("")}</ul></details>` : ""}
          </div>
        </div>`).join("")}
        </div>
      </section>`;
    }).join("")}
    ${plan.extra.map((e) => `<section class="phase"><div class="panel panel-pad md"><h3 style="margin-top:0">${esc(e.title)}</h3>${md(e.body)}</div></section>`).join("")}`;
}

function renderDoc(label, markdown) {
  const heads = headingsOf(markdown);
  return `<div class="eyebrow">${esc(label)}</div>
  <div class="doc-layout">
    <article class="panel doc md" id="doc">${md(markdown)}</article>
    ${heads.length > 2 ? `<aside class="toc"><div class="toc-title">on this page</div>
      ${heads.map((h) => `<a href="javascript:void 0" data-jump="${slug(h.text)}" style="padding-left:${(h.level - 2) * 12}px">${esc(h.text)}</a>`).join("")}</aside>` : ""}
  </div>`;
}

async function renderFindingFile(file) {
  const res = await fetch(`/files/${encodeURIComponent(state.audit.name)}/findings/${encodeURIComponent(file)}`);
  if (!res.ok) return `<div class="empty">Could not load ${esc(file)}.</div>`;
  const text = await res.text();
  if (file.endsWith(".json")) {
    return `<div class="eyebrow">findings/${esc(file)}</div><h1 class="page-title">${esc(prettyName(file))}</h1>
      <div class="panel doc md" style="margin-top:24px"><pre><code>${esc(JSON.stringify(JSON.parse(text), null, 2))}</code></pre></div>`;
  }
  return renderDoc(`findings/${file}`, text);
}

// The cluster agent writes a free-text status per page ("gap: new", "written: verify …", "written-thin (…)").
// Turn it into one plain action plus the note that explains it.
const PAGE_ACTIONS = {
  create: { label: "Create", tone: "bad", help: "This page doesn't exist yet. Write it so the site has something to rank for the target search." },
  hub: { label: "Build hub", tone: "bad", help: "The URL only shows a filtered /explore list today. Make it a real page with its own intro text and links to every page in its topic." },
  rewrite: { label: "Rewrite", tone: "warn", help: "The page exists, but there's too little real content on it to rank." },
  adjust: { label: "Adjust", tone: "warn", help: "The page exists and fits the plan. It needs the one change described." },
  keep: { label: "Keep", tone: "good", help: "Already good enough for its place in the plan. Only the links listed under it need adding." },
  review: { label: "Review", tone: "muted", help: "The audit gave a status this viewer doesn't recognise. Read the note." },
};
function pageAction(status = "") {
  const s = status.toLowerCase();
  const paren = (status.match(/\(([^)]*)\)/) || [])[1] || "";
  const after = status.includes(":") ? status.slice(status.indexOf(":") + 1).trim() : "";
  let k;
  if (/^gap/.test(s)) k = /hub/.test(s) ? "hub" : "create";
  else if (/thin|rewrite/.test(s)) k = "rewrite";
  else if (/^(written|exists|live)/.test(s)) k = after ? "adjust" : "keep";
  else k = "review";
  const note = after && !/^new$/i.test(after) ? after : paren && k !== "keep" ? paren : "";
  return { k, ...PAGE_ACTIONS[k], note: note.replace(/^./, (c) => c.toUpperCase()), detail: k === "keep" ? paren : "" };
}
const TEMPLATE_LABELS = {
  "ultimate-guide": "long overview guide", "best-of": "best-of list", listicle: "list article", review: "guide to one trip",
  "how-to": "how-to guide", comparison: "comparison",
};

async function renderClusters() {
  const base = `/files/${encodeURIComponent(state.audit.name)}/findings`;
  const res = await fetch(`${base}/cluster-plan.json`);
  if (!res.ok) return `<div class="empty">No cluster-plan.json in this audit.</div>`;
  const plan = await res.json();
  const report = await fetch(`${base}/cluster.md`).then((r) => (r.ok ? r.text() : ""));
  const archScore = (report.match(/score:\s*(\d+)\s*\/\s*100/i) || [])[1];

  const clusters = plan.clusters || [];
  const nodes = [plan.pillar, ...clusters.flatMap((c) => c.posts || [])].filter(Boolean);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const links = plan.links || [];
  const filter = state.clusterFilter || "";
  const counts = nodes.reduce((acc, n) => ((acc[pageAction(n.status).k] = (acc[pageAction(n.status).k] || 0) + 1), acc), {});
  const toDo = nodes.length - (counts.keep || 0);

  const page = (p, role) => {
    const a = pageAction(p.status);
    if (filter && a.k !== filter) return "";
    const incoming = links.filter((l) => l.to === p.id && byId[l.from]);
    return `<div class="row-item cp-page">
      <div class="cp-action"><span class="act act-${a.tone}" title="${esc(a.help)}">${a.label}</span></div>
      <div style="min-width:0">
        <div class="post-title">${esc(p.title)}</div>
        <div class="post-meta"><span class="role">${role}</span> <code>${esc(p.url || "")}</code></div>
        <div class="cp-target">aims to rank for <b>“${esc(p.keyword)}”</b>${(p.secondary || p.secondary_keywords || []).length ? ` <span class="muted">+ ${(p.secondary || p.secondary_keywords).map((k) => `“${esc(k)}”`).join(", ")}</span>` : ""}</div>
        <div class="cp-spec mono">${esc(TEMPLATE_LABELS[p.template] || p.template || "")}${p.wordCount ? ` · ~${p.wordCount.toLocaleString()} words` : ""}${a.detail ? ` · now ${esc(a.detail)}` : ""}</div>
        ${a.note ? `<div class="cp-note"><span class="tag">${a.k === "keep" ? "note" : "to do"} →</span>${esc(a.note)}</div>` : ""}
        ${incoming.length ? `<details class="cp-links"><summary>${incoming.length} pages should link here</summary>
          <ul>${incoming.map((l) => `<li><span class="muted">from</span> ${esc(byId[l.from].title)} <span class="muted">with the link text</span> “${esc(l.anchor || "")}”${l.type === "optional" ? ` <span class="muted">(optional)</span>` : ""}</li>`).join("")}</ul></details>` : ""}
      </div>
    </div>`;
  };

  const supporting = plan.supporting_pages_outside_cap || {};
  const clusterPanel = (c) => {
    const posts = c.posts || [];
    const rows = posts.map((p) => page(p, p.url === c.hub_url ? "hub" : "page")).join("");
    if (filter && !rows) return "";
    const ready = posts.filter((p) => pageAction(p.status).k === "keep").length;
    const extra = supporting[c.hub_url] || [];
    return `<div class="rows">
      <div class="panel-title">${esc(c.name)}<span class="pill">${ready}/${posts.length} ready</span></div>
      ${rows}
      ${extra.length && !filter ? `<div class="row-item cp-extra"><details><summary>${extra.length} more existing pages belong to this topic</summary>
        <p class="muted">No changes needed. Just link each one to the hub and to one or two pages above.</p>
        <ul>${extra.map((u) => `<li><code>${esc(u)}</code></li>`).join("")}</ul></details></div>` : ""}
    </div>`;
  };

  const actionOrder = ["create", "hub", "rewrite", "adjust", "keep", "review"];
  const overlaps = plan.cannibalization || [];

  return `
    <div class="eyebrow">content plan · findings/cluster-plan.json</div>
    <h1 class="page-title">Content plan</h1>
    <p class="page-sub">Which pages ${esc(state.audit.domain)} should have to rank for “${esc(plan.seed_keyword)}” and related searches,
      grouped by topic, with what to do with each one.</p>

    <div class="panel panel-pad cp-explain">
      <div class="cp-tree mono" aria-hidden="true">
        <div class="cp-node">pillar</div><div class="cp-arrow">→</div>
        <div class="cp-node">5 topic hubs</div><div class="cp-arrow">→</div>
        <div class="cp-node">pages</div>
      </div>
      <p>Google ranks a site higher on a subject when it has a page for each part of that subject, all linked together. The plan has three levels:</p>
      <ul>
        <li><b>Pillar</b>: one long overview page (<code>${esc(plan.pillar?.url || "/explore")}</code>) that links to everything below it.</li>
        <li><b>Hubs</b>: one page per topic, such as “sleeper trains”, listing that topic's pages.</li>
        <li><b>Pages</b>: one detailed page per search people make, such as “bernina express vs glacier express”.</li>
      </ul>
      <p class="muted" style="margin-bottom:0">Each page shows one action. Hover an action for what it means. “Aims to rank for” is the search the page is written for.</p>
    </div>

    <div class="panel kpis" style="margin-top:16px">
      ${archScore ? `<div class="kpi"><div class="kpi-label">Structure score</div><div class="kpi-value" style="color:${scoreColor(+archScore)}">${archScore}<small>/100</small></div><div class="kpi-foot">how well pages are organised today</div></div>` : ""}
      <div class="kpi"><div class="kpi-label">Pages in plan</div><div class="kpi-value">${nodes.length}</div><div class="kpi-foot">${clusters.length} topics + pillar</div></div>
      <div class="kpi"><div class="kpi-label"><span class="dot" style="--c:var(--bad)"></span>To create</div><div class="kpi-value">${(counts.create || 0) + (counts.hub || 0)}</div><div class="kpi-foot">${counts.hub || 0} hubs · ${counts.create || 0} new pages</div></div>
      <div class="kpi"><div class="kpi-label"><span class="dot" style="--c:var(--good)"></span>Ready</div><div class="kpi-value">${counts.keep || 0}<small>/${nodes.length}</small></div><div class="kpi-foot">${toDo - (counts.create || 0) - (counts.hub || 0)} need a fix or rewrite</div></div>
    </div>

    <div class="toolbar" style="margin-top:24px"><div class="seg">
      <button class="${!filter ? "on" : ""}" data-act="">All<span class="n">${nodes.length}</span></button>
      ${actionOrder.filter((k) => counts[k]).map((k) => `<button class="${filter === k ? "on" : ""}" data-act="${k}" title="${esc(PAGE_ACTIONS[k].help)}"><span class="dot" style="--c:var(--${PAGE_ACTIONS[k].tone === "muted" ? "faint" : PAGE_ACTIONS[k].tone})"></span>${PAGE_ACTIONS[k].label}<span class="n">${counts[k]}</span></button>`).join("")}
    </div></div>

    ${plan.pillar && (!filter || pageAction(plan.pillar.status).k === filter) ? `${sectionHead("Pillar page")}<div class="rows">${page(plan.pillar, "pillar")}</div>` : ""}
    ${sectionHead("Topics")}
    <div class="grid grid-2 cp-grid">${clusters.map(clusterPanel).join("") || `<div class="empty">No pages with this action.</div>`}</div>

    ${overlaps.length && !filter ? `${sectionHead("Pages competing with each other", `${overlaps.length} overlaps`)}
    <p class="muted" style="margin:-4px 0 12px;font-size:13px">When two of your pages target the same search, Google picks one and both rank worse. Give each page its own search.</p>
    <div class="rows">${overlaps.map((o) => `<div class="row-item finding">
      <div>${sevBadge(o.severity)}</div>
      <div><div class="f-title">“${esc(o.keyword)}”</div>
        <div class="f-desc">${(o.pages || []).map((p) => `<code class="mono">${esc(p)}</code>`).join(" vs ")}</div></div>
      <div class="f-fix"><span class="tag">fix →</span><span>${esc(o.fix)}</span></div>
    </div>`).join("")}</div>` : ""}

    ${plan.data_notes ? `<p class="muted" style="font-size:12px;margin-top:24px">Data caveat: ${esc(plan.data_notes)}</p>` : ""}`;
}

function renderScreens() {
  const a = state.audit;
  const imgs = [...a.screenshots.map((f) => `screenshots/${f}`), ...a.charts.map((f) => `charts/${f}`)];
  if (!imgs.length) return `<div class="empty">No screenshots in this audit.</div>`;
  return `<div class="eyebrow">screenshots/</div><h1 class="page-title">Screenshots</h1>
    <p class="page-sub">Captured by the visual agent. Click to enlarge.</p>
    <div class="shots">${imgs.map((p) => {
      const src = `/files/${encodeURIComponent(a.name)}/${p}`;
      const label = p.split("/").pop().replace(/\.\w+$/, "").split("_").pop();
      return `<div class="panel shot"><img src="${src}" alt="${esc(label)} screenshot" loading="lazy" data-zoom="${src}">
        <div class="shot-cap"><span>${esc(label)}</span><a href="${src}" target="_blank">open ↗</a></div></div>`;
    }).join("")}</div>`;
}

function renderPdf(file) {
  const src = `/files/${encodeURIComponent(state.audit.name)}/${encodeURIComponent(file)}`;
  return `<div class="phase-head"><div><div class="eyebrow">${esc(file)}</div><h1 class="page-title">PDF report</h1></div>
    <a class="btn" href="${src}" target="_blank">Open in new tab ↗</a></div>
    <iframe class="pdf-frame" src="${src}" title="${esc(file)}" style="margin-top:16px"></iframe>`;
}

// ---------- Navigation ----------

function navEntries() {
  const a = state.audit;
  const tasks = planItems().length;
  const views = [
    ["overview", "Overview", ""],
    tasks && ["plan", "Action plan", tasks],
    ["findings", "Findings", allFindings().length],
    a.report && ["report", "Full report", ""],
    a.findings.includes("cluster-plan.json") && ["clusters", "Content plan", ""],
    a.screenshots.length && ["screens", "Screenshots", a.screenshots.length],
  ].filter(Boolean);
  const reports = a.findings.filter((f) => f !== "cluster-plan.json").map((f) => ["f/" + f, prettyName(f), ""]);
  const exports = a.pdfs.map((f) => ["pdf/" + f, "PDF report", ""]);
  return { views, reports, exports };
}

function renderSidebar(route) {
  const { views, reports, exports } = navEntries();
  const link = ([hash, label, count]) =>
    `<a class="nav-link ${route === hash ? "active" : ""}" href="#${hash}"><span>${esc(label)}</span><span class="nav-count">${count}</span></a>`;
  $("#sidebar").innerHTML = `
    <div class="nav-group">audit</div>${views.map(link).join("")}
    ${reports.length ? `<div class="nav-group">specialist reports</div>${reports.map(link).join("")}` : ""}
    ${exports.length ? `<div class="nav-group">exports</div>${exports.map(link).join("")}` : ""}`;
}

async function route() {
  if (!state.audit) return;
  const [path, query] = decodeURIComponent(location.hash.slice(1) || "overview").split("?");
  const params = new URLSearchParams(query || "");
  if (path === "findings" && params.get("sev")) state.findingsFilter.sev = new Set([params.get("sev")]);
  if (path === "findings" && params.get("q")) state.findingsFilter = { sev: new Set(), cat: "", q: params.get("q") };
  renderSidebar(path);
  $("#sidebar").classList.remove("open");

  const c = $("#content");
  let html;
  if (path === "plan") html = renderPlan();
  else if (path === "findings") html = renderFindings();
  else if (path === "report") html = renderDoc("FULL-AUDIT-REPORT.md", state.audit.report);
  else if (path === "clusters") html = await renderClusters();
  else if (path === "screens") html = renderScreens();
  else if (path.startsWith("f/")) html = await renderFindingFile(path.slice(2));
  else if (path.startsWith("pdf/")) html = renderPdf(path.slice(4));
  else html = renderOverview();
  c.innerHTML = html;
  decorate(c);
  const target = state.pendingJump && document.getElementById(state.pendingJump);
  state.pendingJump = null;
  if (target) target.scrollIntoView();
  else window.scrollTo(0, 0);
}

// Post-render touches: heading ids for the TOC, severity words in markdown become badges.
function decorate(root) {
  root.querySelectorAll(".md h2, .md h3").forEach((h) => (h.id = slug(h.textContent)));
  root.querySelectorAll(".md td:first-child, .md li").forEach((el) => {
    el.innerHTML = el.innerHTML.replace(/^(\s*(?:<[^>]+>)*)(CRITICAL|Critical|HIGH|High|MEDIUM|Medium|LOW|Low|INFO|Info)\b:?/, (m, pre, sev) =>
      `${pre}${sevBadge(sev)}`);
  });
}

// ---------- Command palette ----------

const palette = { items: [], shown: [], sel: 0 };

function paletteSource() {
  const { views, reports, exports } = navEntries();
  const go = (hash) => () => { location.hash = hash; };
  const out = [
    ...views.map(([h, l]) => ({ group: "Views", title: l, hint: "#" + h, run: go(h) })),
    ...reports.map(([h, l]) => ({ group: "Reports", title: l, hint: h.slice(2), run: go(h) })),
    ...exports.map(([h, l]) => ({ group: "Reports", title: l, hint: h.slice(4), run: go(h) })),
    ...planItems().map((i) => ({
      group: "Tasks", title: i.title.replace(/[*`]/g, ""), hint: (isDone(i) ? "✓ " : "") + "task " + i.num,
      run: async () => {
        if (location.hash !== "#plan") { location.hash = "plan"; await new Promise((r) => setTimeout(r, 30)); await route(); }
        const el = document.getElementById("task-" + slug(taskKey(i)));
        el?.scrollIntoView({ block: "center" });
        el?.animate([{ background: "var(--accent-soft)" }, { background: "transparent" }], { duration: 1400 });
      },
    })),
    ...allFindings().sort((a, b) => sevRank(a.severity) - sevRank(b.severity)).map((f) => ({
      group: "Findings", title: f.title, hint: `${String(f.severity).toLowerCase()} · ${f.category}`, sev: f.severity,
      run: () => { state.findingsFilter = { sev: new Set(), cat: "", q: f.title }; location.hash === "#findings" ? route() : (location.hash = "findings"); },
    })),
    ...state.audits.filter((a) => a.name !== state.audit.name).map((a) => ({
      group: "Audits", title: `${a.domain} · ${a.date}`, hint: `${a.score}/100`, run: () => loadAudit(a.name),
    })),
    { group: "Commands", title: "Toggle light / dark theme", hint: "theme", run: toggleTheme },
  ];
  return out;
}

function renderPalette() {
  const q = $("#paletteInput").value.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  palette.shown = palette.items
    .map((it) => {
      const hay = (it.title + " " + it.hint + " " + it.group).toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return null;
      return { it, rank: q && it.title.toLowerCase().startsWith(q) ? 0 : 1 };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 60)
    .map((x) => x.it);
  palette.sel = Math.min(palette.sel, Math.max(0, palette.shown.length - 1));
  let last = null;
  $("#paletteList").innerHTML = palette.shown.length
    ? palette.shown.map((it, i) => {
        const head = it.group !== last ? `<div class="palette-group">${esc(it.group.toLowerCase())}</div>` : "";
        last = it.group;
        return `${head}<div class="palette-item ${i === palette.sel ? "sel" : ""}" data-pi="${i}" role="option">
          ${it.sev ? `<span class="dot ${sevClass(it.sev)}"></span>` : ""}<span class="p-title">${esc(it.title)}</span><span class="p-hint">${esc(it.hint)}</span></div>`;
      }).join("")
    : `<div class="empty">Nothing matches “${esc(q)}”.</div>`;
  $(".palette-item.sel")?.scrollIntoView({ block: "nearest" });
}

function openPalette() {
  if (!state.audit) return;
  palette.items = paletteSource();
  palette.sel = 0;
  $("#palette").hidden = false;
  $("#paletteInput").value = "";
  renderPalette();
  $("#paletteInput").focus();
}
const closePalette = () => ($("#palette").hidden = true);
function runPalette(i) {
  const it = palette.shown[i];
  if (!it) return;
  closePalette();
  it.run();
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("seo-viewer-theme", root.dataset.theme); } catch {}
}

// ---------- Events ----------

let saveTimer;
function saveProgress() {
  const el = $("#saveState");
  if (el) el.textContent = "saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const res = await fetch(`/api/audit/${encodeURIComponent(state.audit.name)}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.audit.progress),
    });
    const el2 = $("#saveState");
    if (el2) el2.textContent = res.ok ? "saved · progress.json" : "save failed";
  }, 300);
}

document.addEventListener("click", (e) => {
  const pi = e.target.closest("[data-pi]");
  if (pi) return runPalette(Number(pi.dataset.pi));
  if (e.target.id === "palette") return closePalette();
  const aud = e.target.closest("[data-audit]");
  if (aud) return loadAudit(aud.dataset.audit);
  const cat = e.target.closest("tr[data-cat]");
  if (cat) { state.findingsFilter = { sev: new Set(), cat: cat.dataset.cat, q: "" }; location.hash = "findings"; return; }
  const chip = e.target.closest("button[data-sev]");
  if (chip) {
    const s = state.findingsFilter.sev;
    s.has(chip.dataset.sev) ? s.delete(chip.dataset.sev) : s.add(chip.dataset.sev);
    history.replaceState(null, "", "#findings");
    route();
    return;
  }
  const act = e.target.closest("button[data-act]");
  if (act) { state.clusterFilter = act.dataset.act; route(); return; }
  const rj = e.target.closest("[data-report-jump]");
  if (rj) {
    state.pendingJump = rj.dataset.reportJump;
    location.hash === "#report" ? route() : (location.hash = "report");
    return;
  }
  const jump = e.target.closest("[data-jump]");
  if (jump) { document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: "smooth" }); return; }
  const zoom = e.target.closest("[data-zoom]");
  if (zoom) { const lb = $("#lightbox"); $("img", lb).src = zoom.dataset.zoom; lb.hidden = false; return; }
  if (e.target.closest("#lightbox")) $("#lightbox").hidden = true;
});

document.addEventListener("change", (e) => {
  if (e.target.matches("[data-task]")) {
    const p = state.audit.progress;
    p.done = p.done || {};
    if (e.target.checked) p.done[e.target.dataset.task] = new Date().toISOString().slice(0, 10);
    else delete p.done[e.target.dataset.task];
    const scroll = window.scrollY;
    route().then(() => { window.scrollTo(0, scroll); saveProgress(); });
  }
  if (e.target.id === "fcat") { state.findingsFilter.cat = e.target.value; route(); }
  if (e.target.id === "auditSelect") loadAudit(e.target.value);
});

document.addEventListener("input", (e) => {
  if (e.target.id === "fq") {
    state.findingsFilter.q = e.target.value;
    const pos = e.target.selectionStart;
    route().then(() => { const i = $("#fq"); i.focus(); i.setSelectionRange(pos, pos); });
  }
  if (e.target.id === "paletteInput") { palette.sel = 0; renderPalette(); }
});

document.addEventListener("keydown", (e) => {
  const open = !$("#palette").hidden;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open ? closePalette() : openPalette(); return; }
  if (e.key === "Escape") { closePalette(); $("#lightbox").hidden = true; return; }
  if (open) {
    if (e.key === "ArrowDown") { e.preventDefault(); palette.sel = Math.min(palette.sel + 1, palette.shown.length - 1); renderPalette(); }
    if (e.key === "ArrowUp") { e.preventDefault(); palette.sel = Math.max(palette.sel - 1, 0); renderPalette(); }
    if (e.key === "Enter") { e.preventDefault(); runPalette(palette.sel); }
    return;
  }
  if (e.key === "/" && !e.target.closest("input, textarea, select")) { e.preventDefault(); openPalette(); }
});

$("#menuBtn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#searchBtn").addEventListener("click", openPalette);
$("#themeBtn").addEventListener("click", toggleTheme);
window.addEventListener("hashchange", route);

async function loadAudit(name) {
  state.audit = await (await fetch(`/api/audit/${encodeURIComponent(name)}`)).json();
  state.findingsFilter = { sev: new Set(), cat: "", q: "" };
  $("#domainTitle").textContent = state.audit.domain;
  $("#domainSub").textContent = `${state.audit.date} · ${state.audit.score ?? "?"}/100`;
  $("#auditSelect").value = name;
  document.title = `${state.audit.domain} · SEO audit`;
  if (migrateProgress()) saveProgress();
  route();
}

// Always open the newest audit; older ones stay reachable from the picker, history chart and palette.
(async function init() {
  state.audits = await (await fetch("/api/audits")).json();
  if (!state.audits.length) {
    $("#content").innerHTML = `<div class="empty">No <code>*-audit</code> folders with audit-data.json found.</div>`;
    return;
  }
  $("#auditSelect").innerHTML = state.audits
    .map((a) => `<option value="${esc(a.name)}">${esc(a.domain)} · ${esc(a.date)} · ${a.score ?? "?"}</option>`)
    .join("");
  $("#auditSelect").hidden = state.audits.length < 2;
  loadAudit(state.audits[0].name);
})();
