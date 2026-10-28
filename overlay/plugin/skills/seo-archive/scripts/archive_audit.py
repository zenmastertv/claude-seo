#!/usr/bin/env python3
"""Archive live {domain}-audit/ folders so the next /seo audit starts fresh.

Renames each live audit folder (one holding audit-data.json) to
{domain}-{yyyy-mm-dd}-{hhmm}-audit, the name the SEO audit viewer reads as an
older audit of the same domain. The date and time come from the report's
"Audit date: YYYY-MM-DD [HH:MM]" line, else from audit-data.json's modified
time. Nothing is deleted or overwritten.

Usage:
    archive_audit.py [--dir DIR] [--domain DOMAIN] [--dry-run]

Output: JSON with the folders archived, skipped and any errors.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime

ARCHIVED_RE = re.compile(r"-\d{4}-\d{2}-\d{2}(?:-\d{4})?-audit$")
DATE_RE = re.compile(r"Audit date:\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):?(\d{2}))?")


def live_audits(root, domain=None):
    """Return live audit folder names in root, optionally for one domain."""
    names = []
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if not (os.path.isdir(path) and name.endswith("-audit")):
            continue
        if ARCHIVED_RE.search(name):
            continue
        if not os.path.isfile(os.path.join(path, "audit-data.json")):
            continue
        if domain and name != f"{domain}-audit":
            continue
        names.append(name)
    return names


def audit_stamp(path):
    """Return (yyyy-mm-dd, hhmm) for the audit in path."""
    mtime = datetime.fromtimestamp(os.path.getmtime(os.path.join(path, "audit-data.json")))
    report = os.path.join(path, "FULL-AUDIT-REPORT.md")
    if os.path.isfile(report):
        with open(report, encoding="utf-8", errors="replace") as f:
            match = DATE_RE.search(f.read())
        if match:
            hhmm = match.group(2) + match.group(3) if match.group(2) else mtime.strftime("%H%M")
            return match.group(1), hhmm
    return mtime.strftime("%Y-%m-%d"), mtime.strftime("%H%M")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dir", default=os.getcwd(), help="folder holding the *-audit folders (default: current)")
    parser.add_argument("--domain", help="archive only {domain}-audit")
    parser.add_argument("--dry-run", action="store_true", help="show the renames without doing them")
    args = parser.parse_args()

    root = os.path.abspath(args.dir)
    result = {"dir": root, "dry_run": args.dry_run, "archived": [], "errors": []}
    if not os.path.isdir(root):
        result["errors"].append(f"{root} is not a folder")
        print(json.dumps(result, indent=2))
        return 1

    for name in live_audits(root, args.domain):
        date, hhmm = audit_stamp(os.path.join(root, name))
        domain = name[: -len("-audit")]
        dest = f"{domain}-{date}-{hhmm}-audit"
        if os.path.exists(os.path.join(root, dest)):
            result["errors"].append(f"{dest} already exists; {name} left as is")
            continue
        if not args.dry_run:
            os.rename(os.path.join(root, name), os.path.join(root, dest))
        result["archived"].append({"from": name, "to": dest})

    if not result["archived"] and not result["errors"]:
        result["message"] = "No live *-audit folder with audit-data.json found."
    print(json.dumps(result, indent=2))
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
