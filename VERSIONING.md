# Remote-GUI Versioning

This document describes how versioning works across the Remote-GUI project: one source of truth for the release version, git-based build metadata, and how to bump versions.

---

## Protocol: how to version (TL;DR)

**One number for the whole app:** The **`VERSION`** file at the repo root is the only place you edit for the “release version.” Plugins don’t have their own version numbers unless you add them; they ship with the app.

| Situation | What you do |
|-----------|-------------|
| **Daily work (features, bugs, plugin work)** | Don’t touch `VERSION`. Commit as usual. `/version` will show current `VERSION` + git commit, branch, and `dirty` if you have uncommitted changes. |
| **Release (e.g. “1.0.0 is done”)** | Bump `VERSION` (e.g. to `1.0.0`), commit, then optionally `git tag v1.0.0`. |
| **Pre-release (e.g. beta)** | Set `VERSION` to something like `1.0.0-beta.1` and optionally tag `v1.0.0-beta.1`. |

**Working on plugins:** You still only bump `VERSION` when the **app** has a release. While developing a plugin, your identity is **branch + commit (+ dirty)**. No separate “plugin version” unless you add one (e.g. a `version` field in the plugin’s router or config).

**Scheme (when to bump which part):** See [Scheme (semantic versioning)](#scheme-semantic-versioning) below.

---

## Push workflow: what comes after `git add`

You have two cases: **just pushing your changes** (no new release number) or **pushing a release** (bump version and tag).

### Just pushing your work (no release)

You finished a bunch of changes and want to push the branch. **Do not bump `VERSION`.**

```bash
git add .                              # or specific files
git commit -m "Describe your changes"   # e.g. "UNS plugin: add export"
git push
```

If your branch is new: `git push -u origin <branch-name>`. The app’s version stays whatever is in `VERSION`; `GET /version` will show that plus the new commit and branch after you push.

### Pushing a release (bump version + tag)

You’re happy with the state of the branch and want this push to be **release X.Y.Z** (e.g. 1.1.0).

1. **Commit all your work** (if not already committed):
   ```bash
   git add .
   git commit -m "Your feature/fix summary"
   ```

2. **Bump version, create a release commit and tag** (from repo root):
   ```bash
   python3 scripts/bump_version.py minor --commit --tag   # or patch / major
   ```
   This updates `VERSION`, commits it, and creates the tag (e.g. `v1.1.0`).

3. **Push branch and tags**:
   ```bash
   git push
   git push --tags
   ```
   Or in one line: `git push && git push --tags`.

So after `git add`, the flow is: **commit** → (if releasing: **run bump script with --commit --tag**) → **push** → **push --tags** (if you created a tag).

---

## Patch notes: `CHANGELOG.txt`

- **File:** `CHANGELOG.txt` at the repository root.
- **Format:** Newest release at top. Each section is `## X.Y.Z - YYYY-MM-DD` followed by bullet points.
- **How it’s updated:** When you run the bump script with `--commit` (or `--tag`), it prepends a new section for the new version and commits it together with `VERSION`. Pass notes with `--notes "Fix export" "Add filter"` or `--notes-file release_notes.txt`.

Example:

```
## 1.1.1 - 2025-02-03
- Fix export in UNS plugin
- Add status filter

## 1.1.0 - 2025-01-15
- Initial release
```

---

## Single source of truth: `VERSION`

- **File:** `VERSION` at the repository root.
- **Format:** One line, semantic version: `MAJOR.MINOR.PATCH` or `MAJOR.MINOR.PATCH-SUFFIX` (e.g. `1.0.0`, `1.2.0-dev`).
- **Use:** This is the **release version** shown in the API, HTML version page, and used for support/debugging. Bump this when you cut a release or want to communicate a new version to users.

## Git metadata (automatic)

When the app runs from a git clone, the version module also reports:

| Field   | Description |
|--------|-------------|
| `commit` | Short commit hash (7 chars) |
| `commit_full` | Full commit SHA |
| `date` | Last commit date (UTC) |
| `branch` | Current branch, or `detached` |
| `dirty` | `true` if there are uncommitted changes |

These are computed at runtime (no GitPython dependency; uses `git` via subprocess). If not in a git repo or git is unavailable, these fields are empty and `git_available` is `false`.

## Where version is used

1. **API:** `GET /version` — JSON with `version`, git fields, and app metadata. Always available (no feature gate).
2. **HTML:** `GET /version.html` — Human-readable version page (Jinja2 template).
3. **Backend:** `version_info.get_version_info()` — Use this anywhere you need the current version (e.g. logging, health checks).

## How to bump the version

**By hand:** Edit **`VERSION`** at the repo root, then commit and optionally tag.

**Automated (recommended):** Use the bump script from repo root:

```bash
# Bump patch (1.0.0 -> 1.0.1); only updates VERSION file
python scripts/bump_version.py patch

# Bump minor, then commit and tag (e.g. 1.0.0 -> 1.1.0, commit + tag v1.1.0)
python scripts/bump_version.py minor --commit --tag

# Pre-release: bump patch and add suffix (1.0.0 -> 1.0.1-dev)
python scripts/bump_version.py patch --suffix -dev

# See what would happen without writing anything
python scripts/bump_version.py minor --dry-run
```

| Option | Effect |
|--------|--------|
| `patch` / `minor` / `major` | Which part to bump (required). |
| `--commit` | Run `git add VERSION` and `git commit -m "Bump version to X.Y.Z"`. |
| `--tag` | Create annotated tag `vX.Y.Z` (run after commit; use with `--commit` to do both in one go). |
| `--suffix SUFFIX` | Set or keep a suffix (e.g. `-dev`, `-beta.1`). Omit to keep current suffix or get a clean version. |
| `--dry-run` | Print new version only; do not write `VERSION` or run git. |
| `--notes "line1" "line2"` | Patch notes for this release (each argument = one bullet in `CHANGELOG.txt`). Use with `--commit`. |
| `--notes-file PATH` | Path to a file (relative to repo root) with patch notes; one bullet per line. Use with `--commit`. |

When you use `--commit` (or `--tag`), the script also updates **`CHANGELOG.txt`** at the repo root: it prepends a new section for the new version with today’s date and your notes (or “(No notes for this release.)” if you omit `--notes` and `--notes-file`). That way every release has a patch-notes entry.

Run from the repo root so git sees the right directory. The script finds the repo by looking for `VERSION` and `.git`.

### Scheme (semantic versioning)

Use **MAJOR.MINOR.PATCH** in `VERSION`:

| Part | When to bump | Examples |
|------|----------------|----------|
| **MAJOR** | Breaking changes (API, config, or product behaviour users rely on). | `1.0.0` → `2.0.0` |
| **MINOR** | New features or plugins, backward compatible. | `1.0.0` → `1.1.0` |
| **PATCH** | Bug fixes only, no new features, backward compatible. | `1.0.0` → `1.0.1` |

Pre-release: add a suffix, e.g. `1.0.0-dev`, `2.0.0-beta.1`. No need to bump the main number until you actually release.

## Other version numbers in the project

- **`feature_config.json` → `version`:** Schema/format version for the feature config. Can stay at `1.0.0` until you change the config structure.
- **`CLI/local-cli-fe-full/package.json` → `version`:** Frontend package version. You can keep it in sync with `VERSION` manually or via a script if you want one number everywhere; the backend’s `/version` is the canonical runtime version.

## Branches and iterations

- **Branches:** The branch name is included in `GET /version` (and on the HTML page). Use branches for feature work; you can keep the same `VERSION` on many branches and only bump when you release from one of them.

## Working on plugins: how they are versioned

- **By default:** Plugins are **not** versioned separately. The **app** has one version in `VERSION`. Every plugin ships as part of that app; when someone runs the app, `GET /version` shows that single version plus git (commit, branch, dirty). So while you work on a plugin, “what build is this?” is answered by **branch + commit (+ dirty)**.
- **If you want a plugin to expose its own version:** Add a `version` (e.g. `"1.0.0"`) in that plugin’s code (e.g. in its router or `__init__.py`) and expose it via an endpoint or in the plugin’s UI. That’s optional and independent of the main `VERSION` file; the **protocol** stays: you only edit `VERSION` when the **app** gets a release.
- **Releasing:** When you’re ready to release (e.g. “1.0.0 with the new UNS plugin”), bump `VERSION` to `1.0.0`, commit, tag `v1.0.0` if you use tags. No need to version each plugin file; the app version is the contract.

## Summary

| What | Where | When to change |
|------|--------|-----------------|
| **App / release version** | `VERSION` (repo root) | When you cut a release or want to advertise a new version |
| **Patch notes** | `CHANGELOG.txt` (repo root) | Updated by bump script when you use `--commit` with `--notes` or `--notes-file` |
| Git metadata (commit, branch, dirty) | Computed from repo | Automatic |
| Feature config schema | `feature_config.json` → `version` | When config format changes |
| Frontend package | `package.json` → `version` | Optional: align with `VERSION` if desired |
| Plugin-specific version | In plugin code (optional) | Only if you add it; app version is the main contract |

**Quick reference:** Edit only **`VERSION`** for the app (or use `scripts/bump_version.py`). Use **branch + commit (+ dirty)** to identify builds while developing. Bump **MAJOR** for breaking changes, **MINOR** for new features/plugins, **PATCH** for fixes.

---

## Automating version bumps (CI / release workflow)

- **Local releases:** Run `python scripts/bump_version.py minor --commit --tag` (or `patch` / `major`) when you want to cut a release. Push commits and tags: `git push && git push --tags`.
- **CI:** In a release workflow (e.g. GitHub Actions), you can:
  1. **Option A — Tag-driven:** Trigger on a new tag (e.g. `v*`). The workflow checks out the tag; `VERSION` should already be updated and committed before the tag was created (e.g. by running the bump script locally with `--commit --tag`). Build and publish using the tag as the version.
  2. **Option B — Script in CI:** Have the workflow run `python scripts/bump_version.py patch --commit --tag` (or `minor`/`major`) on a release branch, then push the commit and tag. Use a dedicated “release” job with credentials to push.
- **Conventional Commits / semantic-release:** If you later want to bump automatically from commit messages (e.g. `feat:` → minor, `fix:` → patch), you can integrate a tool like `semantic-release` or a small script that parses recent commits and calls `bump_version.py` with the right part. The current setup keeps things simple: you decide when to release and run the script (or do it by hand).
