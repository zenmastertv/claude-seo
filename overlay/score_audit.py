#!/usr/bin/env python3
"""Score an audit-data.json with the fork's fixed rubric, and compare it with
the previous audit of the same domain.

Category score = 100 minus the deductions for its findings (floor 0).
Health score   = the weighted mean of the category scores (fixed weights).

The scores are written back into the file, so the model never picks them.
With --previous, every finding is matched by `id` and the change is printed
as new / unchanged / worse / better / fixed, so a score change can be traced
to specific findings.

Usage: score_audit.py <audit-data.json> [--previous <old audit-data.json>]
"""
import argparse
import json
import sys

DEDUCTION = {"Critical": 20, "High": 8, "Medium": 4, "Low": 1, "Info": 0}
RANK = {"Info": 0, "Low": 1, "Medium": 2, "High": 3, "Critical": 4}
WEIGHTS = {
    "Technical SEO": 22,
    "Content Quality": 23,
    "On-Page SEO": 20,
    "Schema / Structured Data": 10,
    "Performance (CWV)": 10,
    "AI Search Readiness": 10,
    "Images": 5,
}


def findings_by_id(data):
    out = {}
    for cat in data.get("categories", []):
        for f in cat.get("findings", []):
            out[f.get("id") or f["title"]] = (cat["name"], f)
    return out


def score(data):
    errors = []
    for cat in data.get("categories", []):
        if cat["name"] not in WEIGHTS:
            errors.append(f"unknown category {cat['name']!r}")
        if cat.get("no_data"):
            cat["score"] = None
            continue
        total = 0
        for f in cat.get("findings", []):
            if f.get("severity") not in DEDUCTION:
                errors.append(f"{cat['name']}: bad severity {f.get('severity')!r} on {f['title']!r}")
                continue
            if not f.get("id"):
                errors.append(f"{cat['name']}: finding {f['title']!r} has no id")
            total += DEDUCTION[f["severity"]]
        cat["score"] = max(0, 100 - total)
    scored = [c for c in data.get("categories", []) if c.get("score") is not None and c["name"] in WEIGHTS]
    weight = sum(WEIGHTS[c["name"]] for c in scored)
    health = round(sum(c["score"] * WEIGHTS[c["name"]] for c in scored) / weight) if weight else None
    data.setdefault("summary", {})["health_score"] = health
    data["summary"]["scoring"] = "fork rubric v1: Critical -20, High -8, Medium -4, Low -1, Info 0"
    return errors


def compare(new, old):
    new_f, old_f = findings_by_id(new), findings_by_id(old)
    lines = []
    for fid, (cat, f) in new_f.items():
        if fid not in old_f:
            change = "new"
        else:
            ocat, of = old_f[fid]
            diff = RANK[f["severity"]] - RANK.get(of.get("severity"), 0)
            change = "worse" if diff > 0 else "better" if diff < 0 else "unchanged"
            if change != "unchanged" or ocat != cat:
                change += f" (was {of.get('severity')} in {ocat})"
        f["change"] = change
        if not change.startswith("unchanged"):
            lines.append(f"  {change:<40} {f['severity']:<8} {cat}: {f['title']}")
    fixed = [{"id": fid, "category": cat, "title": f["title"], "severity": f.get("severity")}
             for fid, (cat, f) in old_f.items() if fid not in new_f]
    new["fixed_since_previous"] = fixed
    for f in fixed:
        lines.append(f"  {'fixed':<40} {f['severity']:<8} {f['category']}: {f['title']}")

    old_scores = {c["name"]: c.get("score") for c in old.get("categories", [])}
    print("Category scores (previous -> now):")
    for c in new.get("categories", []):
        print(f"  {c['name']:<28} {str(old_scores.get(c['name'])):>4} -> {c.get('score')}")
    print(f"  {'Health':<28} {str(old.get('summary', {}).get('health_score')):>4} -> {new['summary']['health_score']}")
    print("Finding changes:" if lines else "Finding changes: none")
    print("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("--previous")
    args = ap.parse_args()
    data = json.load(open(args.data))
    errors = score(data)
    if args.previous:
        compare(data, json.load(open(args.previous)))
    else:
        for c in data.get("categories", []):
            print(f"  {c['name']:<28} {c.get('score')}")
        print(f"  {'Health':<28} {data['summary']['health_score']}")
    json.dump(data, open(args.data, "w"), indent=2, ensure_ascii=False)
    open(args.data, "a").write("\n")
    if errors:
        print("Rubric problems:\n  " + "\n  ".join(errors), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
