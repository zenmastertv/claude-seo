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

Files in `~/.config/claude-seo/` (all `chmod 600`, never commit them):

| File | What it is |
|---|---|
| `google-api.json` | `api_key` (PageSpeed, CrUX), `oauth_client_path`, optional `ga4_property_id` |
| `client_secret.json` | OAuth client (Web application, redirect URI `http://localhost:8085`) |
| `oauth-token.json` | Search Console / Indexing sign-in, written by `--auth` |

Set `L` once per shell to shorten the commands (fish: `set L ...`):

```bash
L="$HOME/.claude/plugins/marketplaces/zenmastertv-claude-seo/scripts/claude-seo"
```

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
