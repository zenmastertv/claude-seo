#!/usr/bin/env python3
"""Archive a copy of each live {domain}-audit/ folder before the next /seo audit.

Copies each live audit folder (one holding audit-data.json) to
{domain}-{yyyy-mm-dd}-{hhmm}-audit, the name the SEO audit viewer reads as an
older audit of the same domain. The live folder stays in place, so the next
audit can build on it. The date and time are when the audit last ran: the
newest modified time of its audit-data.json, FULL-AUDIT-REPORT.md and
ACTION-PLAN.md (the time typed into the report is not reliable). Nothing is
deleted or overwritten; a folder already archived at that time is skipped.

Usage:
    archive_audit.py [--dir DIR] [--domain DOMAIN] [--dry-run]

Output: JSON with the folders archived, skipped and any errors.
"""

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime

ARCHIVED_RE = re.compile(r"-\d{4}-\d{2}-\d{2}(?:-\d{4})?-audit$")
RUN_FILES = ("audit-data.json", "FULL-AUDIT-REPORT.md", "ACTION-PLAN.md")


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
    """Return (yyyy-mm-dd, hhmm) for when the audit in path last ran."""
    times = [os.path.getmtime(os.path.join(path, f)) for f in RUN_FILES if os.path.isfile(os.path.join(path, f))]
    ran = datetime.fromtimestamp(max(times))
    return ran.strftime("%Y-%m-%d"), ran.strftime("%H%M")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dir", default=os.getcwd(), help="folder holding the *-audit folders (default: current)")
    parser.add_argument("--domain", help="archive only {domain}-audit")
    parser.add_argument("--dry-run", action="store_true", help="show the copies without making them")
    args = parser.parse_args()

    root = os.path.abspath(args.dir)
    result = {"dir": root, "dry_run": args.dry_run, "archived": [], "skipped": [], "errors": []}
    if not os.path.isdir(root):
        result["errors"].append(f"{root} is not a folder")
        print(json.dumps(result, indent=2))
        return 1

    for name in live_audits(root, args.domain):
        date, hhmm = audit_stamp(os.path.join(root, name))
        domain = name[: -len("-audit")]
        dest = f"{domain}-{date}-{hhmm}-audit"
        if os.path.exists(os.path.join(root, dest)):
            result["skipped"].append({"from": name, "to": dest, "reason": "already archived"})
            continue
        if not args.dry_run:
            # copy2 keeps modified times, so the copy keeps the same run time.
            shutil.copytree(os.path.join(root, name), os.path.join(root, dest), copy_function=shutil.copy2)
        result["archived"].append({"from": name, "to": dest})

    if not (result["archived"] or result["skipped"] or result["errors"]):
        result["message"] = "No live *-audit folder with audit-data.json found."
    print(json.dumps(result, indent=2))
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
