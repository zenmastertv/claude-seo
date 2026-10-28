#!/usr/bin/env bash
# Rebuild the fork's `plugin` branch: upstream/main + overlay/ applied to the
# repo's agent files, then force-push it to origin. The plugin is installed
# from that branch:
#
#   claude plugin marketplace add zenmastertv/claude-seo#plugin
#   claude plugin install claude-seo@zenmastertv-claude-seo
#
# The branch is a generated artifact (never edit it by hand), so upstream
# changes never conflict with the overlay. The plugin version gets a
# "+zen.<upstream>.<overlay>" suffix so Claude Code sees every rebuild as a
# new version (it only updates plugins whose version string changed).
#
# Usage: overlay/build_plugin_branch.sh [upstream-ref]   (default upstream/main)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_REF="${1:-upstream/main}"
OVERLAY_BRANCH="local/agent-tuning"
PLUGIN_BRANCH="plugin"
MARKETPLACE_NAME="zenmastertv-claude-seo"

git -C "${REPO_ROOT}" fetch --quiet upstream
git -C "${REPO_ROOT}" fetch --quiet origin
git -C "${REPO_ROOT}" push --quiet origin "${OVERLAY_BRANCH}"

BUILD_DIR="$(mktemp -d)"
trap 'git -C "${REPO_ROOT}" worktree remove --force "${BUILD_DIR}" >/dev/null 2>&1 || true; rm -rf "${BUILD_DIR}"' EXIT
git -C "${REPO_ROOT}" worktree add --quiet --detach "${BUILD_DIR}" "${UPSTREAM_REF}"

cd "${BUILD_DIR}"
git checkout --quiet "${OVERLAY_BRANCH}" -- overlay
python3 overlay/apply_agent_overlay.py --repo >/dev/null

# overlay/skills/<skill>.md is appended to skills/<skill>/SKILL.md.
for patch in overlay/skills/*.md; do
    [[ -e "${patch}" ]] || continue
    skill_file="skills/$(basename "${patch}" .md)/SKILL.md"
    [[ -f "${skill_file}" ]] || { echo "error: ${patch} has no ${skill_file}" >&2; exit 1; }
    cat "${patch}" >> "${skill_file}"
done

UPSTREAM_SHA="$(git rev-parse --short "${UPSTREAM_REF}")"
OVERLAY_SHA="$(git rev-parse --short "${OVERLAY_BRANCH}")"
python3 - "${UPSTREAM_SHA}" "${OVERLAY_SHA}" "${MARKETPLACE_NAME}" <<'PY'
import json, sys
upstream, overlay, market = sys.argv[1:]
plugin_path = ".claude-plugin/plugin.json"
plugin = json.load(open(plugin_path))
base = plugin["version"].split("+")[0]
plugin["version"] = f"{base}+zen.{upstream}.{overlay}"
json.dump(plugin, open(plugin_path, "w"), indent=2, ensure_ascii=False)
open(plugin_path, "a").write("\n")
mp_path = ".claude-plugin/marketplace.json"
mp = json.load(open(mp_path))
mp["name"] = market
json.dump(mp, open(mp_path, "w"), indent=2, ensure_ascii=False)
open(mp_path, "a").write("\n")
print(plugin["version"])
PY

git add -A
git commit --quiet -m "build: plugin = ${UPSTREAM_REF}@${UPSTREAM_SHA} + overlay@${OVERLAY_SHA}"
git push --quiet --force-with-lease="${PLUGIN_BRANCH}" origin "HEAD:refs/heads/${PLUGIN_BRANCH}"
echo "Pushed ${PLUGIN_BRANCH}: $(git rev-parse --short HEAD)"
