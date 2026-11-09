#!/usr/bin/env python3
"""Apply local model/effort overrides to claude-seo subagent files.

Reads overlay/agents.json and rewrites the `model:` and `effort:` lines in the
YAML frontmatter of each listed agent. Only the frontmatter is touched; the
prompt body is left byte-for-byte unchanged.

By default it patches the installed agents in ~/.claude/agents/ (where
install.sh copies them). Pass --repo to patch this checkout's agents/ and
extensions/*/agents/ instead (note: that dirties upstream-tracked files).

Run it again after every reinstall or upstream update.

Usage:
    python3 overlay/apply_agent_overlay.py            # patch ~/.claude/agents
    python3 overlay/apply_agent_overlay.py --dry-run  # show what would change
    python3 overlay/apply_agent_overlay.py --repo     # patch the repo copies
    python3 overlay/apply_agent_overlay.py --target-dir /path/to/agents

Output: JSON summary on stdout.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

OVERLAY_DIR = Path(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = OVERLAY_DIR.parent
CONFIG = OVERLAY_DIR / "agents.json"
VALID_EFFORTS = {"low", "medium", "high", "xhigh", "max"}


def patch_frontmatter(text, model, effort):
    """Return text with model/effort set in the leading frontmatter block."""
    match = re.match(r"^---\n(.*?\n)---\n", text, re.DOTALL)
    if not match:
        raise ValueError("no YAML frontmatter")
    lines = match.group(1).splitlines(keepends=True)
    lines = [line for line in lines if not line.startswith("effort:")]

    model_idx = next((i for i, line in enumerate(lines) if line.startswith("model:")), None)
    if model:
        if model_idx is None:
            model_idx = len(lines)
            lines.append(f"model: {model}\n")
        else:
            lines[model_idx] = f"model: {model}\n"
    if effort:
        insert_at = model_idx + 1 if model_idx is not None else len(lines)
        lines.insert(insert_at, f"effort: {effort}\n")

    return "---\n" + "".join(lines) + "---\n" + text[match.end():]


def target_files(args):
    """Map agent name -> list of files to patch."""
    if args.repo:
        dirs = [REPO_ROOT / "agents", *sorted(REPO_ROOT.glob("extensions/*/agents"))]
    elif args.target_dir:
        dirs = [Path(args.target_dir).expanduser()]
    else:
        dirs = [Path.home() / ".claude" / "agents"]
    files = {}
    for d in dirs:
        for path in sorted(d.glob("seo-*.md")):
            files.setdefault(path.stem, []).append(path)
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--repo", action="store_true", help="patch repo agents/ and extensions/*/agents/")
    group.add_argument("--target-dir", help="patch agents in this directory")
    parser.add_argument("--dry-run", action="store_true", help="report changes without writing")
    args = parser.parse_args()

    overrides = json.loads(CONFIG.read_text(encoding="utf-8"))["agents"]
    files = target_files(args)
    result = {"dry_run": args.dry_run, "changed": [], "unchanged": [], "missing": [], "errors": []}

    for name, spec in overrides.items():
        effort = spec.get("effort")
        if effort and effort not in VALID_EFFORTS:
            result["errors"].append({"agent": name, "error": f"invalid effort {effort!r}"})
            continue
        if name not in files:
            result["missing"].append(name)
            continue
        for path in files[name]:
            try:
                old = path.read_text(encoding="utf-8")
                new = patch_frontmatter(old, spec.get("model"), effort)
            except (OSError, ValueError) as exc:
                result["errors"].append({"agent": name, "file": str(path), "error": str(exc)})
                continue
            entry = {"agent": name, "file": str(path), "model": spec.get("model"), "effort": effort}
            if new == old:
                result["unchanged"].append(entry)
                continue
            if not args.dry_run:
                path.write_text(new, encoding="utf-8")
            result["changed"].append(entry)

    json.dump(result, sys.stdout, indent=2)
    print()
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
