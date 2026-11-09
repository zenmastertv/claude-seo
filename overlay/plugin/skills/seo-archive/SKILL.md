---
name: seo-archive
description: "Save a dated copy of the current {domain}-audit/ folder before re-running /seo audit, so the SEO audit viewer keeps it as history. Use when the user asks to archive, save or keep the last audit, or runs /seo-archive."
user-invocable: true
argument-hint: "[domain] [folder]"
license: MIT
metadata:
  author: zenmastertv (fork overlay)
  version: "1.0.0"
  category: seo
---

# Archive the current SEO audit

Copies each live `{domain}-audit/` folder to `{domain}-{yyyy-mm-dd}-{hhmm}-audit/`.
The live folder stays where it is, so the next `/seo audit` can build on the last one.
The date and time are when that audit last ran (its output files' modified time).
The SEO audit viewer shows the copy as an older audit of the same domain, with the
score history and carried-over action-plan ticks. Nothing is deleted or overwritten.

## Steps

1. Pick the folder: the one the user names, else the current directory.
2. Run, adding `--domain <domain>` only if the user named one:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/skills/seo-archive/scripts/archive_audit.py" --dir "<folder>"
   ```

3. Report each `from` → `to` copy from the JSON output, plus any `skipped`
   (already archived), `message` or `errors`. Do not rename, move or delete anything.
4. Tell the user they can now run `/seo audit <url>`. Do not start the audit yourself.
