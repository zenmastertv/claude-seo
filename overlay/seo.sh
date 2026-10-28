#!/usr/bin/env bash
# One entry point for the maintenance chores in overlay/MAINTENANCE.md.
# Works on Linux and macOS (bash 3.2+).
#
# Usage: overlay/seo.sh <command>
#   google      first-time Google setup: certificates, client secret, sign-in,
#               API key, then a check. Safe to re-run; skips what is done.
#   login       sign in to Google again (token expired or revoked)
#   check       show which Google APIs work
#   doctor      show the plugin's Python runtime status
#   rebuild     upstream/main + overlay → push the `plugin` branch
#               (pass a tag to build a release: rebuild v2.6.0)
#   update      pull the rebuilt plugin into Claude Code
#   reinstall   remove and install the plugin from scratch
set -euo pipefail

OVERLAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ID="claude-seo@zenmastertv-claude-seo"
MARKETPLACE="zenmastertv-claude-seo"
CONF_DIR="${HOME}/.config/claude-seo"
SECRET="${CONF_DIR}/client_secret.json"
CONFIG="${CONF_DIR}/google-api.json"
TOKEN="${CONF_DIR}/oauth-token.json"

die() { echo "error: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

# The installed copy, not the marketplace git clone: that one counts as a
# manual install and ignores the runtime `/seo setup` built.
launcher() {
    local root
    root="$(python3 - "${PLUGIN_ID}" <<'PY'
import json, os, sys
path = os.path.expanduser("~/.claude/plugins/installed_plugins.json")
try:
    print(json.load(open(path))["plugins"][sys.argv[1]][0]["installPath"])
except (OSError, KeyError, IndexError, ValueError):
    pass
PY
)"
    [[ -n "${root}" ]] || die "plugin not installed. Run: overlay/seo.sh reinstall"
    echo "${root}/scripts/claude-seo"
}

seo_run() { "$(launcher)" "$@"; }

# python.org builds on macOS ship without CA certificates until their
# "Install Certificates.command" has run; every Google call fails without them.
fix_mac_certs() {
    [[ "$(uname)" == "Darwin" ]] || return 0
    python3 -c 'import urllib.request; urllib.request.urlopen("https://www.googleapis.com/discovery/v1/apis", timeout=10)' \
        >/dev/null 2>&1 && return 0
    local ver cmd
    ver="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
    cmd="/Applications/Python ${ver}/Install Certificates.command"
    [[ -x "${cmd}" ]] || die "Python ${ver} cannot verify HTTPS certificates and ${cmd} is missing"
    step "Installing Python ${ver} certificates"
    "${cmd}"
}

json_get() {
    python3 - "${CONFIG}" "$1" <<'PY'
import json, sys
try:
    print(json.load(open(sys.argv[1])).get(sys.argv[2], ""))
except (OSError, ValueError):
    pass
PY
}

json_set() {
    python3 - "${CONFIG}" "$1" "$2" <<'PY'
import json, sys
path, key, value = sys.argv[1:]
try:
    data = json.load(open(path))
except (OSError, ValueError):
    data = {}
data[key] = value
json.dump(data, open(path, "w"), indent=2)
open(path, "a").write("\n")
PY
}

cmd_google() {
    step "Checking Python can reach Google"
    fix_mac_certs
    mkdir -p "${CONF_DIR}" && chmod 700 "${CONF_DIR}"

    if [[ ! -f "${SECRET}" ]]; then
        local found
        found="$(ls -t "${HOME}"/Downloads/client_secret_*.json 2>/dev/null | head -1 || true)"
        [[ -n "${found}" ]] || die "no client_secret_*.json in ~/Downloads. Download it from
  Google Cloud Console → APIs & Services → Credentials → your OAuth client
  (Add secret if there is no download button), then run this again."
        step "Moving $(basename "${found}") into place"
        mv "${found}" "${SECRET}"
    fi

    if [[ ! -f "${TOKEN}" ]]; then
        cmd_login
    fi

    if [[ -z "$(json_get api_key)" ]]; then
        step "API key (PageSpeed + CrUX)"
        local key
        read -r -p "Paste the API key (blank to skip): " key
        [[ -z "${key}" ]] || json_set api_key "${key}"
    fi

    if [[ -z "$(json_get ga4_property_id)" ]]; then
        local ga4
        read -r -p "GA4 property ID, digits only (blank to skip): " ga4
        ga4="${ga4#properties/}"
        [[ -z "${ga4}" ]] || json_set ga4_property_id "properties/${ga4}"
    fi

    chmod 600 "${CONF_DIR}"/*.json
    cmd_check
}

cmd_login() {
    [[ -f "${SECRET}" ]] || die "missing ${SECRET}. Run: overlay/seo.sh google"
    fix_mac_certs
    step "Google sign-in: a browser tab opens, approve it"
    echo "    ('This app isn't verified' is expected: Advanced → Go to the app)"
    seo_run run google_auth.py --auth --creds "${SECRET}"
}

cmd_check() {
    step "Google API check"
    seo_run run google_auth.py --check || true
}

case "${1:-}" in
    google)    cmd_google ;;
    login)     cmd_login ;;
    check)     cmd_check ;;
    doctor)    seo_run doctor ;;
    rebuild)   "${OVERLAY_DIR}/build_plugin_branch.sh" "${@:2}" ;;
    update)
        claude plugin marketplace update "${MARKETPLACE}"
        claude plugin update "${PLUGIN_ID}"
        echo "Start a new Claude session to load it." ;;
    reinstall)
        claude plugin uninstall "${PLUGIN_ID}" || true
        claude plugin marketplace remove "${MARKETPLACE}" || true
        claude plugin marketplace add zenmastertv/claude-seo#plugin
        claude plugin install "${PLUGIN_ID}"
        echo "Start a new Claude session, then run /seo setup." ;;
    *)  sed -n '5,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
