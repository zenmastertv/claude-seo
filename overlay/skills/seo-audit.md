
## Audit modes and history (fork overlay)

Invoking `/seo audit` or `/seo full audit` is the user's explicit request to use the
subagents listed above. Do not shrink either mode to a fetch-only summary.

- `/seo full audit <url>`: every applicable subagent, in parallel.
- `/seo audit <url>`: the core subagents only (`seo-technical`, `seo-content`,
  `seo-schema`, `seo-sitemap`, `seo-geo`, `seo-sxo`), unless the user asks for full.

Both modes keep a history the SEO audit viewer can show:

1. **Where:** write `{domain}-audit/` next to any existing `*-audit/` folders in the
   project (in trainlink that is `SEOAudit/`); otherwise in the current directory.
2. **Archive first:** if `{domain}-audit/` already exists, run
   `seo-viewer archive {domain}` before writing anything. Without `seo-viewer`, rename
   the folder to `{domain}-{yyyy-mm-dd}-audit`, taking the date from the old
   `FULL-AUDIT-REPORT.md` `Audit date:` line. Never overwrite or delete an old audit.
3. **Always write** `audit-data.json` (the viewer skips folders without it),
   `FULL-AUDIT-REPORT.md` with an `Audit date: YYYY-MM-DD` line near the top,
   `ACTION-PLAN.md`, and `findings/*.md`. Use the same category names as earlier audits
   of the domain so score changes line up.
4. **Never** write a loose `*-seo-audit-*.md` file instead of the folder, and never
   create `progress.json` (the viewer carries action-plan ticks over by itself).
