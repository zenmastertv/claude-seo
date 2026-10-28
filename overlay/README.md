# Local agent overlay

Fork-only model/effort overrides for the claude-seo subagents. Lives outside
`agents/` so pulling upstream never conflicts.

- `agents.json`: the model (`haiku`/`sonnet`/`opus`) and optional `effort`
  (`low`/`medium`/`high`/`xhigh`/`max`) per agent.
- `apply_agent_overlay.py`: writes those values into the agents' frontmatter.
  Idempotent; prompt bodies are never touched.
- `skills/<skill>.md`: text appended to `skills/<skill>/SKILL.md` at build time.
  `seo-audit.md` sets the quick/full audit modes and the archive-first,
  `{domain}-audit/` folder rules the SEO audit viewer depends on. `seo.md`
  makes the `/seo` hub load `seo-audit` for audit commands, since `/seo audit`
  runs the hub skill and would otherwise never see those rules.

- `score_audit.py`: scores `audit-data.json` with a fixed rubric and lists finding
  changes against the previous audit. `skills/seo-audit.md` tells audits to run it.

- `build_plugin_branch.sh`: rebuilds the fork's `plugin` branch as
  upstream/main + this overlay, and pushes it. Never edit `plugin` by hand.

## Install (plugin)

```bash
claude plugin marketplace add zenmastertv/claude-seo#plugin
claude plugin install claude-seo@zenmastertv-claude-seo
```

## Updating from upstream (or after editing agents.json)

```bash
git switch local/agent-tuning              # commit any agents.json change here
overlay/build_plugin_branch.sh             # rebuild + push the plugin branch
claude plugin marketplace update zenmastertv-claude-seo
claude plugin update claude-seo@zenmastertv-claude-seo
```

Then start a new session. Use `apply_agent_overlay.py --dry-run` to preview,
`--repo` to patch a checkout, or no flag for a manual `~/.claude/agents` install.
