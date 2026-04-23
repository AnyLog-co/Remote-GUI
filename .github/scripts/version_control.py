#!/usr/bin/env python3
"""
update_changelog.py
-------------------
Reads CHANGELOG.md, finds the <!-- last-processed: {hash} --> marker,
collects all commits on the current branch since that hash, categorizes
them by file path, groups by author, and inserts bullet points into the
Unreleased section.

Usage:
    python3 .github/workflows/update_changelog.py \
        --changelog CHANGELOG.md \
        --branch os-dev

The script commits the updated CHANGELOG.md back to the branch.
"""

import argparse
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime

def get_current_branch():
    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True,
        text=True
    )
    return result.stdout.strip()

CHANGELOG_FILE = os.path.join(os.path.dirname(__file__).split(".github", 1)[0], "CHANGELOG.md")
GIT_BRANCH = get_current_branch()

# ---------------------------------------------------------------------------
# Category map — ordered longest prefix first (specificity wins)
# ---------------------------------------------------------------------------
CATEGORY_MAP = [
    # Backend — specific first
    ("backend/routers/uns",             "Backend / UNS"),
    ("backend/routers/blockchain",      "Backend / Blockchain"),
    ("backend/routers/sql",             "Backend / SQL"),
    ("backend/routers/monitoring",      "Backend / Monitoring"),
    ("backend/routers/video",           "Backend / Video streaming"),
    ("backend/routers/blob",            "Backend / Blobs"),
    ("backend/routers/mcp",             "Backend / MCP"),
    ("backend/routers",                 "Backend / API"),
    ("backend/plugins",                 "Backend / Plugins"),
    ("backend/ssh",                     "Backend / SSH client"),
    ("backend/auth",                    "Backend / Auth"),
    ("backend",                         "Backend"),

    # Frontend — specific first
    ("frontend/src/plugins/uns",        "Frontend / UNS plugin"),
    ("frontend/src/plugins/mcp",        "Frontend / MCP plugin"),
    ("frontend/src/plugins/grafana",    "Frontend / Grafana plugin"),
    ("frontend/src/plugins/report",     "Frontend / Report Generator plugin"),
    ("frontend/src/plugins/ssh",        "Frontend / SSH CLI plugin"),
    ("frontend/src/plugins/video",      "Frontend / Video plugin"),
    ("frontend/src/plugins",            "Frontend / Plugins"),
    ("frontend/src/components/dashboard", "Frontend / Dashboard"),
    ("frontend/src/components/blockchain", "Frontend / Blockchain manager"),
    ("frontend/src/components/sql",     "Frontend / SQL query builder"),
    ("frontend/src/components",         "Frontend / Components"),
    ("frontend/src/pages",              "Frontend / Pages"),
    ("frontend/src",                    "Frontend"),
    ("frontend",                        "Frontend"),

    # Infrastructure
    ("docker-compose",                  "Docker"),
    ("Dockerfile",                      "Docker"),
    ("start.sh",                        "Docker"),
    (".github/workflows",               "CI/CD"),
    (".github/scripts",                 "CI/CD"),
    ("setup.cfg",                       "Dependencies"),
    ("requirements",                    "Dependencies"),
    ("package.json",                    "Dependencies"),
]

# Files/paths to skip entirely — no bullet generated
SKIP_PATTERNS = [
    ".md",
    "__pycache__",
    ".gitignore",
    ".DS_Store",
    "node_modules/",
    ".venv/",
    "venv/",
    "dist/",
    "build/",
]

# Commit messages that indicate noise — skip the whole commit
SKIP_MESSAGES = [
    "chore: update version",
    "chore: update changelog",
    "merge branch",
    "merge remote-tracking",
    "tmp",
    "in progress",
    "to test",
    "testing",
    "testing a fix",
    "quick fix",
    "minor fix",
    "minor change",
    "revert",
    "working code",
    "working docker",
    "small",
    "fixes",
    "fix",           # too generic on its own — real fixes should say what
    "trying",
    "trying to fix",
    "pre develop",
    "os dev",
    "merged",
    "merge",
    "demo",
    "cleanup",
    "reorg",
]

# Authors that are bots — skip entirely
BOT_AUTHORS = [
    # "github-actions[bot]",
    # "anylog-ci-bot[bot]",
]


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

def run_git(args, cwd=None):
    """Run a git command and return stdout as a string."""
    result = subprocess.run(
        ["git"] + args,
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    if result.returncode != 0:
        print(f"[ERROR] git {' '.join(args)}\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    return result.stdout.strip()


def get_commits_since(branch, since_hash=None, since_date=None):
    """
    Return a list of commit dicts since since_hash on branch.
    If since_hash is empty, return all commits on the branch.
    """
    git_args = ["log", branch, "--no-merges"]
    if since_hash:
        # git_args = ["log", f"{since_hash}..{branch}", "--no-merges"]
        git_args = ["log", f"{since_hash}..HEAD", "--no-merges"]
    elif since_date:
        git_args += [f"--after={since_date}"]

    # Use a unique separator to safely split fields
    sep = "||FIELD||"
    fmt = f"%H{sep}%an{sep}%ad{sep}%s"
    raw = run_git([
        *git_args,
        f"--pretty=format:{fmt}",
        "--date=short",
        "--no-merges",
    ])

    if not raw:
        return []

    commits = []
    for line in raw.splitlines():
        parts = line.split(sep)
        if len(parts) != 4:
            continue
        hash_, author, date, message = parts
        commits.append({
            "hash":    hash_[:7],
            "author":  author.strip(),
            "date":    date.strip(),
            "message": message.strip(),
        })
    return commits


def get_files_changed(commit_hash):
    """Return list of files changed in a commit."""
    raw = run_git(["diff-tree", "--no-commit-id", "-r", "--name-only", commit_hash])
    return [f.strip() for f in raw.splitlines() if f.strip()]


# ---------------------------------------------------------------------------
# Categorization
# ---------------------------------------------------------------------------

def categorize_file(filepath):
    """
    Return a category string for a file path, or None if it should be skipped.
    Longest prefix wins (CATEGORY_MAP is ordered).
    """
    # Normalize separators
    fp = filepath.replace("\\", "/")

    # Skip patterns
    for pattern in SKIP_PATTERNS:
        if pattern in fp:
            return None

    # Match category
    for prefix, category in CATEGORY_MAP:
        if fp.startswith(prefix) or f"/{prefix}" in fp:
            return category

    # Uncategorized but not skipped — return generic label
    return "General"


def categorize_commit(commit):
    """
    Return a set of categories for a commit based on files changed.
    Returns empty set if the commit should be skipped entirely.
    """
    message_lower = commit["message"].lower()

    # Skip noise commits
    for skip in SKIP_MESSAGES:
        if message_lower.startswith(skip):
            return set()

    # Skip bot authors
    if commit["author"] in BOT_AUTHORS:
        return set()

    files = get_files_changed(commit["hash"])
    categories = set()
    all_skipped = True

    for f in files:
        cat = categorize_file(f)
        if cat is not None:
            categories.add(cat)
            all_skipped = False
        else:
            all_skipped = False  # file exists but is skipped

    # If every file was a skip pattern, skip the whole commit
    if not files or (all_skipped and not categories):
        return set()

    return categories if categories else {"General"}


# ---------------------------------------------------------------------------
# Bullet formatting
# ---------------------------------------------------------------------------

def format_author_bullet(author, date_start, date_end, messages_by_category):
    """
    Format one bullet + sub-bullets per category.

    * **Author** (date_range)
      * Category1: message1; message2
      * Category2: message3
    """
    if date_start == date_end:
        date_str = date_start
    else:
        date_str = f"{date_start} – {date_end}"

    lines = [f"* **{author}** ({date_str})"]
    for category in sorted(messages_by_category):
        # Deduplicate messages within category
        seen = []
        for m in messages_by_category[category]:
            if m not in seen:
                seen.append(m)
        lines.append(f"  * {category}: {'; '.join(seen)}")

    return "\n".join(lines)

def build_bullets(commits):
    if not commits:
        return []

    author_data = defaultdict(lambda: {
        "dates": [],
        "messages_by_category": defaultdict(list),
    })

    for commit in commits:
        author = commit["author"]
        if author in BOT_AUTHORS:
            continue

        cats = categorize_commit(commit)
        if not cats:
            continue

        author_data[author]["dates"].append(commit["date"])
        for cat in cats:
            author_data[author]["messages_by_category"][cat].append(commit["message"])

    bullets = []
    for author, data in author_data.items():
        dates = sorted(data["dates"])
        bullet = format_author_bullet(
            author=author,
            date_start=dates[0],
            date_end=dates[-1],
            messages_by_category=data["messages_by_category"],
        )
        bullets.append(bullet)

    return bullets

# ---------------------------------------------------------------------------
# CHANGELOG manipulation
# ---------------------------------------------------------------------------

LAST_PROCESSED_RE = re.compile(r"<!--\s*last-processed:\s*(\S*)\s*-->")
DEVELOPER_MARKER  = "<!-- Developers: add bullets below as changes land in your branch -->"


def read_changelog(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_changelog(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def get_last_processed(content):
    """Extract the hash from <!-- last-processed: {hash} -->. Returns '' if empty."""
    m = LAST_PROCESSED_RE.search(content)
    if not m:
        print("[ERROR] Could not find <!-- last-processed: --> marker in CHANGELOG.md",
              file=sys.stderr)
        sys.exit(1)
    return m.group(1).strip()


def update_last_processed(content, new_hash):
    """Replace the last-processed hash."""
    return LAST_PROCESSED_RE.sub(f"<!-- last-processed: {new_hash} -->", content)


def insert_bullets(content, bullets, latest_hash, latest_date):
    if not bullets:
        return content

    bullet_block = "\n".join(bullets)

    m = LAST_PROCESSED_RE.search(content)
    if not m:
        print("[ERROR] last-processed marker not found", file=sys.stderr)
        sys.exit(1)

    insert_pos = m.end()

    dev_pos = content.find(DEVELOPER_MARKER, insert_pos)
    if dev_pos == -1:
        print("[ERROR] Developer marker not found in CHANGELOG.md", file=sys.stderr)
        sys.exit(1)

    between = content[insert_pos:dev_pos]

    # Add latest commit header above the bullets
    # sample output: f"\n\n<!-- os-dev: 4bc33f1 (2026-04-09) -->\n\n{bullet_block}\n\n" + between.lstrip("\n")
    new_between = f"\n\n<!-- {get_current_branch()}: {latest_hash} ({latest_date}) -->\n\n{bullet_block}\n\n" + between.lstrip("\n")

    return content[:insert_pos] + new_between + content[dev_pos:]


# ---------------------------------------------------------------------------
# Git commit
# ---------------------------------------------------------------------------

def commit_changelog(changelog_path, branch):
    # detect if running in GitHub Actions
    in_ci = os.environ.get("GITHUB_ACTIONS") == "true"

    if in_ci:
        run_git(["config", "user.name",  "anylog-ci-bot[bot]"])
        run_git(["config", "user.email", "anylog-ci-bot[bot]@users.noreply.github.com"])
    # locally — use whatever git config is already set, don't override

    run_git(["add", changelog_path])
    result = subprocess.run(["git", "diff", "--cached", "--quiet"], capture_output=True)
    if result.returncode == 0:
        print("[INFO] No changes to CHANGELOG.md — nothing to commit.")
        return

    if in_ci:
        run_git(["commit", "-m", f"chore: update CHANGELOG unreleased [skip ci]"])
    else:
        run_git(["commit", "-s", "-m", f"chore: update CHANGELOG unreleased [skip ci]"])

    run_git(["pull", "--rebase", "origin", branch])
    run_git(["push"])

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    """
    Based on `git log` update CHANGELOG.md
    if start-date and/or last-commit specified use that as the initial starting point
    """
    parser = argparse.ArgumentParser(description="Auto-update CHANGELOG.md Unreleased section.")
    parser.add_argument("--changelog", default=CHANGELOG_FILE,   help="Path to CHANGELOG.md")
    parser.add_argument("--branch",    default=GIT_BRANCH,         help="Current branch name")
    parser.add_argument("--start-date", type=str, default="None", help="Date to start scanning the logs from")
    parser.add_argument("--last-commit", type=str, default=None, help="Last commit integrated into the changelogs.")
    parser.add_argument("--dry-run",   action="store_true",      help="Print bullets but do not write or commit")
    args = parser.parse_args()

    if not os.path.isfile(args.changelog):
        try:
            open(args.changelog, 'w').close()
        except Exception as error:
            raise FileNotFoundError(f"Failed to locate CHANGELOG - {args.changelog} (Error: {error})")

    # 1. Read current CHANGELOG
    content = read_changelog(args.changelog)

    # 2. Find last processed hash
    # last_hash = get_last_processed(content)
    last_hash = args.last_commit or get_last_processed(content)
    print(f"[INFO] Last processed commit: {last_hash or '(none — will process all)'}")

    # 3. Get commits since last hash
    commits = get_commits_since(branch=args.branch, since_hash=last_hash, since_date=args.start_date)
    print(f"[INFO] Found {len(commits)} new commit(s) to process")

    if not commits:
        print("[INFO] Nothing to do.")
        return

    # 4. Build bullets
    bullets = build_bullets(commits)
    print(f"[INFO] Generated {len(bullets)} bullet(s)")

    latest_hash = commits[0]["hash"]
    latest_date = commits[0]["date"]

    if not bullets:
        print("[INFO] All commits were noise/skippable — updating last-processed marker only.")
        if not args.dry_run:
            content = update_last_processed(content, latest_hash)
            write_changelog(args.changelog, content)
            commit_changelog(args.changelog, args.branch)
        return

    # 5. Print preview
    latest_hash = commits[0]["hash"]
    latest_date = commits[0]["date"]
    print(f"\n--- Latest commit: {latest_hash} ({latest_date}) ---")
    print("\n--- Preview ---")
    for b in bullets:
        print(b)
    print("---------------\n")

    if args.dry_run:
        print("[DRY RUN] No changes written.")
        return

    # 6. Update content
    latest_hash = commits[0]["hash"]  # commits are newest-first
    content = insert_bullets(content, bullets, latest_hash, latest_date)

    content = update_last_processed(content, latest_hash)

    # 7. Write
    write_changelog(args.changelog, content)
    print(f"[INFO] CHANGELOG.md updated. last-processed → {latest_hash}")

    # 8. Commit
    commit_changelog(args.changelog, args.branch)


if __name__ == "__main__":
    main()