
## Audit routing (fork overlay)

`/seo audit <url>`, `/seo full audit <url>` and `/seo audit full <url>` are audit
commands, not general SEO questions. Before fetching anything:

1. Load the `seo-audit` skill with the Skill tool (`claude-seo:seo-audit`) and follow
   it, including its "Audit modes and history (fork overlay)" section. That section
   picks the subagents for each mode and holds the archive-first `{domain}-audit/`
   rules the SEO audit viewer depends on.
2. The user typing either command is their explicit request to spawn the audit
   subagents with the Agent tool. Do not replace them with your own curl or fetch
   pass, and do not label the result a "quick pass" or a partial score.
3. Finish with the PDF offer from step 16 of the Orchestration Logic above.
