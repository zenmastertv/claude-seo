# Local agent overlay

Fork-only model/effort overrides for the claude-seo subagents. Lives outside
`agents/` so pulling upstream never conflicts.

- `agents.json`: the model (`haiku`/`sonnet`/`opus`) and optional `effort`
  (`low`/`medium`/`high`/`xhigh`/`max`) per agent.
- `apply_agent_overlay.py`: writes those values into the agents' frontmatter.
  Idempotent; prompt bodies are never touched.

## Updating from upstream

```bash
git fetch upstream
git switch local/agent-tuning
git rebase upstream/main
bash install.sh                            # or however you reinstall
python3 overlay/apply_agent_overlay.py     # re-apply to ~/.claude/agents
git push --force-with-lease origin local/agent-tuning
```

Use `--dry-run` to preview, `--repo` to patch the checkout's `agents/` and
`extensions/*/agents/` copies instead of the installed ones.
