# SEO audit viewer

A zero-dependency Node app that wraps the output of the claude-seo `/seo audit` skill
(`{domain}-audit/` folders) in a browsable interface.

```bash
seo-viewer                       # start + open the browser; Ctrl+C stops it
seo-viewer /path/to/audits       # read audits from another folder
seo-viewer archive trainlink.eu  # before re-auditing: trainlink.eu-audit -> trainlink.eu-2026-10-28-audit
PORT=5000 seo-viewer
```

`seo-viewer` is symlinked into `~/.local/bin`. With no folder given it uses the current
directory if it holds `*-audit` folders, otherwise the folder above `viewer/`.
`node viewer/server.js [dir] [--port N]` still works directly.

## Re-running an audit

1. `seo-viewer archive <domain>` renames the current folder to a dated one (date from the report).
2. Run `/seo audit` again; it writes a fresh `<domain>-audit/`.
3. Reload the viewer: it opens the newest audit, the overview shows a score history with
   per-category deltas, and older audits stay in the picker.

Action-plan ticks are stored by task title. A new audit with no `progress.json` starts with
the previous audit's ticks for every task whose title is unchanged; renamed or new tasks start unticked.

What it reads from each `{domain}-audit/` folder (only `audit-data.json` is required):

| File | View |
|---|---|
| `audit-data.json` | Overview (score ring, category bars, top issues, quick wins, roadmap), Findings explorer |
| `ACTION-PLAN.md` | Action plan checklist; ticks are saved to `progress.json` in the audit folder |
| `FULL-AUDIT-REPORT.md` | Full report (category weights are read from its summary table) |
| `findings/*.md`, `findings/*.json` | Specialist reports |
| `findings/cluster-plan.json` | Content clusters (pillar, hubs, gap vs written pages) |
| `screenshots/`, `charts/` | Screenshot gallery |
| `*.pdf` | Embedded PDF report |

Run a new audit into the same root folder and it shows up in the audit picker.
Markdown is rendered with `marked` loaded from jsDelivr, so the reports need a network connection to format nicely (they fall back to plain text offline).
