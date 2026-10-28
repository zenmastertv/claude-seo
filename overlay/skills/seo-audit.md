
## Audit modes and history (fork overlay)

Invoking `/seo audit` or `/seo full audit` is the user's explicit request to use the
subagents listed above. Do not shrink either mode to a fetch-only summary.

- `/seo full audit <url>` (or `/seo audit full <url>`): every applicable subagent,
  in parallel.
- `/seo audit <url>`: the core subagents only (`seo-technical`, `seo-content`,
  `seo-schema`, `seo-sitemap`, `seo-geo`, `seo-sxo`), unless the user asks for full.

Both modes keep a history the SEO audit viewer can show:

1. **Where:** write `{domain}-audit/` next to any existing `*-audit/` folders in the
   project (in trainlink that is `SEOAudit/`); otherwise in the current directory.
2. **Archive first:** if `{domain}-audit/` already exists, run
   `seo-viewer archive {domain} <folder from step 1>` before writing anything. Without
   `seo-viewer`, rename the folder to `{domain}-{yyyy-mm-dd}-{hhmm}-audit`, taking the
   date and time from the old `FULL-AUDIT-REPORT.md` `Audit date:` line (or the
   `audit-data.json` modified time if it has no time). Never overwrite or delete an
   old audit.
3. **Always write** `audit-data.json` (the viewer skips folders without it),
   `FULL-AUDIT-REPORT.md` with an `Audit date: YYYY-MM-DD HH:MM` line (local time)
   near the top,
   `ACTION-PLAN.md`, and `findings/*.md`. Use the same category names as earlier audits
   of the domain so score changes line up.
4. **Never** write a loose `*-seo-audit-*.md` file instead of the folder, and never
   create `progress.json` (the viewer carries action-plan ticks over by itself).

## Consistent scoring (fork overlay)

Scores must come from the rubric below, never from judgment, so two audits of an
unchanged site get the same score. These rules replace any per-category scoring the
subagents suggest.

1. **Read the previous audit first.** If an archived `{domain}-*-audit/audit-data.json`
   exists, load the newest one before scoring. Reuse its `sample_urls` (add new URLs on
   top, never drop old ones) and its finding `id`s.
2. **One `id` per issue.** Give every finding a short kebab-case `id` (for example
   `alt-text-wikimedia-filenames`). An issue seen before keeps its old `id`, `title`,
   category and severity. Change the severity only when the evidence shows the scope or
   impact changed, and say why in the description ("was Medium: now affects 40 pages,
   was 10"). Never re-grade an unchanged issue.
3. **One home category per issue.** Record each issue once, in the category below. Other
   categories may mention it in prose but must not list it as a finding.

   | Issue | Category |
   |---|---|
   | Crawling, indexing, redirects, canonicals, sitemaps, robots, security headers, caching, JS rendering | Technical SEO |
   | Depth, facts, thin or duplicate content, E-E-A-T, authors, dates | Content Quality |
   | Titles, meta descriptions, headings, internal linking, keyword targeting | On-Page SEO |
   | JSON-LD and structured data | Schema / Structured Data |
   | Measured LCP, INP/TBT, CLS, third-party script cost, render-blocking | Performance (CWV) |
   | Alt text, image weight, formats, srcset, dimensions | Images |
   | Brand entity, off-site mentions, citability, AI crawlers, llms.txt and agent files | AI Search Readiness |

4. **Severity by impact, using these tests:**
   - **Critical**: blocks indexing or ranking site-wide, or a live security or legal exposure.
   - **High**: stops many key pages from being indexed or ranking well, or a Core Web
     Vital in the "poor" band.
   - **Medium**: hurts a group of pages or one important page; a Core Web Vital in
     "needs improvement".
   - **Low**: hygiene with small effect.
   - **Info**: optional or draft standards (llms.txt, Content-Signal, WebMCP, ai-catalog)
     and unverified suspicions. Never higher than Info until verified.
5. **Lab metrics.** Without CrUX field data, run PageSpeed Insights 3 times per URL and
   use the median. Grade a metric by its band (good / needs improvement / poor); a change
   inside the same band is not a change.
6. **Let the script score.** Do not write scores by hand. After writing
   `audit-data.json` (scores may be 0), run:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/overlay/score_audit.py" {domain}-audit/audit-data.json \
     --previous <newest archived audit-data.json>
   ```

   (leave out `--previous` on a first audit). It writes every category score and the
   health score (Critical -20, High -8, Medium -4, Low -1, Info 0, floor 0; fixed
   weights), tags each finding `new`/`unchanged`/`worse`/`better`, and lists
   `fixed_since_previous`. Fix any "Rubric problems" it reports and run it again. Set
   `"no_data": true` on a category that could not be checked; it is left out of the
   health score.
7. **Explain the change.** Add `sample_urls` to `audit-data.json`, and put the script's
   score table and finding changes in a "Changes since previous audit" section of
   `FULL-AUDIT-REPORT.md`. If the health score moved, name the findings that moved it.
