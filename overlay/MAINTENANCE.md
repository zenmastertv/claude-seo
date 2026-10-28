# Maintenance cheat sheet

Everything runs through one script from the repo checkout (`~/claude-seo` on
Linux, `~/Github/claude-seo` on the Mac). Works the same on Linux and macOS.

| Command | When |
|---|---|
| `overlay/seo.sh rebuild` | Pick up the latest upstream (or `rebuild v2.6.0` for a tag) |
| `overlay/seo.sh update` | After a rebuild: pull it into Claude Code, then start a new session |
| `overlay/seo.sh reinstall` | An update misbehaves, or first install on a new machine |
| `overlay/seo.sh google` | First-time Google setup (safe to re-run) |
| `overlay/seo.sh login` | Google sign-in expired or revoked |
| `overlay/seo.sh check` | Which Google APIs work |
| `overlay/seo.sh doctor` | Is the Python runtime ready |

## Routine update

```bash
overlay/seo.sh rebuild
overlay/seo.sh update
```

Then start a **new Claude session** and run `/seo doctor`. If it says not
ready, run `/seo setup`. Never `pip install` by hand.

Overlay change (`overlay/agents.json`)? Commit it on `local/agent-tuning`
first; `rebuild` pushes that branch and uses it.

## New machine

1. **Python 3.11–3.14** on `PATH` (macOS: the built-in 3.9 is too old;
   install from python.org or `brew install python@3.13`). macOS also needs
   `brew install pango` for PDF reports.
2. Clone the fork:

   ```bash
   git clone https://github.com/zenmastertv/claude-seo.git
   cd claude-seo
   git remote add upstream https://github.com/AgriciDaniel/claude-seo.git
   git switch local/agent-tuning
   ```

3. `overlay/seo.sh reinstall`, start a new Claude session, run `/seo setup`.
4. Google: download the client secret (below), then `overlay/seo.sh google`.

## Google credentials

`overlay/seo.sh google` does the local part: installs the Python
certificates on macOS if missing, moves `~/Downloads/client_secret_*.json`
into `~/.config/claude-seo/`, opens the browser sign-in, asks for the API key
and GA4 property ID, then runs the check. Re-run it any time; it skips what is
already done.

During sign-in, "This app isn't verified" is expected for your own app:
Advanced → Go to (app name).

### Google Cloud Console (once per project)

At console.cloud.google.com, APIs & Services:

1. **Library**: enable PageSpeed Insights API, Chrome UX Report API, Google
   Search Console API, plus Web Search Indexing API and Google Analytics Data
   API if you use them.
2. **Credentials → Create credentials → API key**. Application restrictions
   **None**; API restrictions PageSpeed + Chrome UX Report.
3. **OAuth consent screen**: External, add yourself as a test user, then
   Audience → **Publish app** (otherwise the sign-in expires every 7 days).
4. **Credentials → Create credentials → OAuth client ID**: Web application,
   redirect URI exactly `http://localhost:8085`. Download the JSON.

Already have the client on another machine? Open it in Credentials and
**Add secret**, then download (Google only shows a secret once).

### Files

All in `~/.config/claude-seo/`, `chmod 600`, never committed:

| File | What it is |
|---|---|
| `client_secret.json` | OAuth client |
| `oauth-token.json` | Sign-in token, written by `login` |
| `google-api.json` | `api_key`, `oauth_client_path`, optional `ga4_property_id` |

### Errors

| Error | Fix |
|---|---|
| `CERTIFICATE_VERIFY_FAILED` (macOS) | `overlay/seo.sh google` installs the certificates |
| `redirect_uri_mismatch` | Add `http://localhost:8085` to the OAuth client, wait a few minutes |
| `403 access_denied` | Add yourself as a test user, or publish the app |
| PageSpeed/CrUX rejected | API key is locked to a website; use one with no application restriction |
| Sign-in lasts 7 days | Publish the app, then `overlay/seo.sh login` |
| "runtime is not ready" | New Claude session → `/seo setup` |

## Running audits

- `/seo audit <url>` → quick, cheaper pass (core subagents only).
- `/seo full audit <url>` → all subagents in parallel, full 0–100 score.
- Both archive the previous `{domain}-audit/` first and write a new one the
  SEO audit viewer can show (rule: `overlay/skills/seo-audit.md`).
- `/seo google report full` → PDF afterwards.

## Extras

Keep the fork's `main` in step with upstream (optional; `rebuild` reads
`upstream/main` directly):

```bash
git fetch upstream && git switch main && git merge --ff-only upstream/main
git push origin main && git switch local/agent-tuning
```

What lives where: overlay on branch `local/agent-tuning` (folder `overlay/`);
the plugin installs from the generated branch `plugin` (never edit it by
hand); the Python runtime lives in `~/.local/share/claude-seo/` (Linux) or
`~/Library/Application Support/claude-seo/` (macOS).
