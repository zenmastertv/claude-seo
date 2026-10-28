# Maintenance cheat sheet

How to keep this fork current with upstream, reinstall the plugin, and keep the
Google credentials working. Commands are run from `~/claude-seo`.

| Thing | Where |
|---|---|
| Upstream (original) | `upstream` → `AgriciDaniel/claude-seo` |
| My fork | `origin` → `zenmastertv/claude-seo` |
| Overlay (my model/effort tweaks) | branch `local/agent-tuning`, folder `overlay/` |
| What the plugin installs from | branch `plugin` (generated, never edit by hand) |
| Google credentials | `~/.config/claude-seo/` |
| Personal rules (`/seo full audit`) | `~/.claude/CLAUDE.md` |

## 1. Sync my `main` with upstream (optional)

The plugin build reads `upstream/main` directly, so this only keeps the fork's
`main` tidy on GitHub.

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
git switch local/agent-tuning
```

If `--ff-only` refuses, `main` has commits of its own: look at
`git log upstream/main..main` before deciding anything.

## 2. Rebuild the plugin from the latest upstream

```bash
git switch local/agent-tuning        # commit any overlay/agents.json change first
overlay/build_plugin_branch.sh       # upstream/main + overlay → force-pushes `plugin`
```

To build from a release tag instead of `main`: `overlay/build_plugin_branch.sh v2.6.0`
(run `git fetch upstream --tags` first).

## 3. Update the installed plugin

```bash
claude plugin marketplace update zenmastertv-claude-seo
claude plugin update claude-seo@zenmastertv-claude-seo
```

Start a **new session** afterwards. Check the version with `/seo doctor`: it
should end in `+zen.<upstream-sha>.<overlay-sha>`.

### Full reinstall (if an update misbehaves)

```bash
claude plugin uninstall claude-seo@zenmastertv-claude-seo
claude plugin marketplace remove zenmastertv-claude-seo
claude plugin marketplace add zenmastertv/claude-seo#plugin
claude plugin install claude-seo@zenmastertv-claude-seo
```

Credentials in `~/.config/claude-seo/` and `~/.claude/CLAUDE.md` are not touched
by an uninstall.

## 4. Python runtime + Chromium

After an update, in a new session:

```
/seo doctor      # ready: true → nothing to do
/seo setup       # only if doctor says not ready
```

Never `pip install` by hand; setup builds an isolated environment.

## 5. Google credentials

Set `L` once per shell to shorten the commands below (fish:
`set L $HOME/.claude/plugins/marketplaces/zenmastertv-claude-seo/scripts/claude-seo`):

```bash
L="$HOME/.claude/plugins/marketplaces/zenmastertv-claude-seo/scripts/claude-seo"
```

### From scratch (new machine or new Google Cloud project)

This is the browser OAuth sign-in (no service account key file).

**a. Google Cloud project and APIs**

1. console.cloud.google.com → pick or create a project (project picker, top bar).
2. APIs & Services → Library → enable:
   - PageSpeed Insights API
   - Chrome UX Report API
   - Google Search Console API
   - Web Search Indexing API (only if you want to request indexing)
   - Google Analytics Data API (only if you use GA4)

**b. API key** (PageSpeed + CrUX)

1. APIs & Services → Credentials → Create credentials → API key.
2. Edit it: Application restrictions = **None**; API restrictions = PageSpeed
   Insights API + Chrome UX Report API. Do not reuse a key locked to a website
   referrer: calls from this machine get rejected.

**c. OAuth consent screen**

1. APIs & Services → OAuth consent screen → get started → **External**.
2. App name anything (e.g. `claude-seo`), your email as support/contact.
3. Audience → add your Google account as a **test user**.
4. Audience → **Publish app** (otherwise the sign-in expires every 7 days).

**d. OAuth client + client secret**

1. Credentials → Create credentials → OAuth client ID → type
   **Web application**.
2. Authorized redirect URIs → add exactly `http://localhost:8085`
   (http, no trailing slash). Save.
3. Download the JSON. It lands in `~/Downloads` as
   `client_secret_<long-id>.apps.googleusercontent.com.json`.

**e. Put the files in place**

```bash
mkdir -p ~/.config/claude-seo && chmod 700 ~/.config/claude-seo
mv ~/Downloads/client_secret_*.json ~/.config/claude-seo/client_secret.json
chmod 600 ~/.config/claude-seo/client_secret.json
```

**f. Sign in through the browser**

```bash
"$L" run google_auth.py --auth --creds ~/.config/claude-seo/client_secret.json
```

A browser tab opens: sign in with the Google account that owns the site in
Search Console and approve. "This app isn't verified" is expected for your own
app: Advanced → Go to (app name). It prints `token saved`, writes
`oauth-token.json`, and creates `google-api.json` with `oauth_client_path`.

**g. Add the API key (and GA4 if used)** to `~/.config/claude-seo/google-api.json`,
keeping the `oauth_client_path` line it already has:

```json
{
  "oauth_client_path": "/home/andrea/.config/claude-seo/client_secret.json",
  "api_key": "YOUR_KEY",
  "ga4_property_id": "properties/123456789"
}
```

Then `chmod 600 ~/.config/claude-seo/google-api.json` and run the `--check`
below: PageSpeed, CrUX, CrUX History, Search Console and Indexing should be OK.

### Day to day

Files in `~/.config/claude-seo/` (all `chmod 600`, never commit them):

| File | What it is |
|---|---|
| `google-api.json` | `api_key` (PageSpeed, CrUX), `oauth_client_path`, optional `ga4_property_id` |
| `client_secret.json` | OAuth client (Web application, redirect URI `http://localhost:8085`) |
| `oauth-token.json` | Search Console / Indexing sign-in, written by `--auth` |

Check what works:

```bash
"$L" run google_auth.py --check
```

Sign in again (token expired, revoked, or password changed):

```bash
"$L" run google_auth.py --auth --creds ~/.config/claude-seo/client_secret.json
```

**Token lasting only 7 days?** The OAuth consent screen is in *Testing*. In
Google Cloud Console → APIs & Services → OAuth consent screen → Audience, click
**Publish app**, then run `--auth` once more.

Common sign-in errors:

- `redirect_uri_mismatch` → add `http://localhost:8085` under the OAuth client's
  Authorized redirect URIs (no trailing slash), wait a few minutes.
- `403 access_denied` → add your Google account as a test user, or publish the app.
- PageSpeed/CrUX rejected → the API key is restricted to the website's referrer;
  use a key with no application restriction, limited to PageSpeed + CrUX APIs.

## 6. Running audits

- `/seo audit <url>` → quick, cheaper pass.
- `/seo full audit <url>` → all subagents in parallel, full 0–100 score
  (rule lives in `~/.claude/CLAUDE.md`).
- `/seo google report full` → PDF afterwards.
