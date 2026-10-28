---
name: seo-archive
description: "Archive the current {domain}-audit/ folder before re-running /seo audit, so the SEO audit viewer keeps it as history. Use when the user asks to archive, save or keep the last audit, or runs /seo-archive."
user-invocable: true
argument-hint: "[domain] [folder]"
license: MIT
metadata:
  author: zenmastertv (fork overlay)
  version: "1.0.0"
  category: seo
---

# Archive the current SEO audit

Renames each live `{domain}-audit/` folder to `{domain}-{yyyy-mm-dd}-{hhmm}-audit/`.
The SEO audit viewer shows those as older audits of the same domain, with the score
history and carried-over action-plan ticks. Nothing is deleted or overwritten.

## Steps

1. Pick the folder: the one the user names, else the current directory.
2. Run, adding `--domain <domain>` only if the user named one:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/skills/seo-archive/scripts/archive_audit.py" --dir "<folder>"
   ```

3. Report each `from` → `to` rename from the JSON output, or its `message` or
   `errors`. Do not rename, move or delete anything else.
4. Tell the user they can now run `/seo audit <url>`. Do not start the audit yourself.
