# Local agent overlay

Fork-only model/effort overrides for the claude-seo subagents, plus one added
skill (`seo-archive`). Upstream skills are not changed. Lives outside
`agents/` so pulling upstream never conflicts.

- `agents.json`: the model (`haiku`/`sonnet`/`opus`) and optional `effort`
  (`low`/`medium`/`high`/`xhigh`/`max`) per agent.
- `apply_agent_overlay.py`: writes those values into the agents' frontmatter.
  Idempotent; prompt bodies are never touched.
- `plugin/`: new files copied into the plugin at build time. The build fails if
  one would replace an upstream file. `plugin/skills/seo-archive/` adds
  `/seo-archive`, which renames the current `{domain}-audit/` to
  `{domain}-{yyyy-mm-dd}-{hhmm}-audit/` so the SEO audit viewer keeps it as history.

- `build_plugin_branch.sh`: rebuilds the fork's `plugin` branch as
  upstream/main + this overlay, and pushes it. Never edit `plugin` by hand.

## Install (plugin)

```bash
claude plugin marketplace add zenmastertv/claude-seo#plugin
claude plugin install claude-seo@zenmastertv-claude-seo
```

## Updating from upstream (or after editing agents.json)

```bash
git switch local/agents-only               # commit any agents.json change here
overlay/build_plugin_branch.sh             # rebuild + push the plugin branch
claude plugin marketplace update zenmastertv-claude-seo
claude plugin update claude-seo@zenmastertv-claude-seo
```

Then start a new session. Use `apply_agent_overlay.py --dry-run` to preview,
`--repo` to patch a checkout, or no flag for a manual `~/.claude/agents` install.
