#!/usr/bin/env python3
"""
Bump the app version in VERSION (repo root).

Usage:
  python scripts/bump_version.py patch              # 1.0.0 -> 1.0.1
  python scripts/bump_version.py minor              # 1.0.0 -> 1.1.0
  python scripts/bump_version.py major              # 1.0.0 -> 2.0.0
  python scripts/bump_version.py patch --commit     # bump + git commit
  python scripts/bump_version.py minor --commit --tag   # bump + commit + git tag
  python scripts/bump_version.py patch --suffix -dev    # 1.0.0 -> 1.0.1-dev

Run from repo root, or set REPO_ROOT. Requires git for --commit / --tag.
"""
import argparse
import os
import re
import subprocess
import sys


def find_repo_root() -> str:
    """Repo root = directory containing VERSION and .git."""
    path = os.path.abspath(os.curdir)
    while path and path != os.path.dirname(path):
        if os.path.isfile(os.path.join(path, "VERSION")) and os.path.isdir(
            os.path.join(path, ".git")
        ):
            return path
        path = os.path.dirname(path)
    # Fallback: directory of this script -> parent = repo root
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(script_dir)
    if os.path.isfile(os.path.join(repo, "VERSION")):
        return repo
    sys.exit("Could not find repo root (directory with VERSION and .git)")


def parse_version(version_str: str) -> tuple:
    """Parse '1.2.3' or '1.2.3-dev' into (1, 2, 3, '') or (1, 2, 3, '-dev')."""
    version_str = version_str.strip()
    # Strip optional suffix for numeric part
    match = re.match(r"^(\d+)\.(\d+)\.(\d+)([.-].*)?$", version_str)
    if not match:
        raise ValueError(f"Invalid VERSION format: {version_str!r}")
    major, minor, patch = int(match.group(1)), int(match.group(2)), int(match.group(3))
    suffix = (match.group(4) or "").strip()
    return major, minor, patch, suffix


def format_version(major: int, minor: int, patch: int, suffix: str = "") -> str:
    """Format as MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH + suffix (suffix should be like '' or '-dev')."""
    base = f"{major}.{minor}.{patch}"
    return base + suffix if suffix else base


def bump(kind: str, major: int, minor: int, patch: int) -> tuple:
    """Return (major, minor, patch) after bumping the given part."""
    if kind == "major":
        return (major + 1, 0, 0)
    if kind == "minor":
        return (major, minor + 1, 0)
    if kind == "patch":
        return (major, minor, patch + 1)
    raise ValueError(f"Unknown bump kind: {kind!r}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Bump VERSION (patch/minor/major), optionally commit and tag."
    )
    parser.add_argument(
        "kind",
        choices=["patch", "minor", "major"],
        help="Which part to bump",
    )
    parser.add_argument(
        "--suffix",
        default=None,
        metavar="SUFFIX",
        help="Append suffix (e.g. -dev, -beta.1). Omit to keep current suffix or produce clean version.",
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Run git add VERSION && git commit -m 'Bump version to X.Y.Z'",
    )
    parser.add_argument(
        "--tag",
        action="store_true",
        help="Create annotated tag vX.Y.Z (implies --commit if you use both)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print new version, do not write VERSION or run git",
    )
    args = parser.parse_args()

    repo_root = os.environ.get("REPO_ROOT") or find_repo_root()
    version_file = os.path.join(repo_root, "VERSION")

    with open(version_file, "r", encoding="utf-8") as f:
        current = f.read().strip().splitlines()[0].strip()

    major, minor, patch, existing_suffix = parse_version(current)
    new_major, new_minor, new_patch = bump(args.kind, major, minor, patch)
    suffix = existing_suffix if args.suffix is None else (
        args.suffix if args.suffix.startswith("-") or args.suffix.startswith(".") else f"-{args.suffix}"
    )
    new_version = format_version(new_major, new_minor, new_patch, suffix)

    print(f"Current: {current}")
    print(f"New:     {new_version}")

    if args.dry_run:
        return

    with open(version_file, "w", encoding="utf-8") as f:
        f.write(new_version + "\n")

    if args.commit or args.tag:
        subprocess.run(
            ["git", "-C", repo_root, "add", "VERSION"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", repo_root, "commit", "-m", f"Bump version to {new_version}"],
            check=True,
        )
        print("Committed VERSION")

    if args.tag:
        tag_name = f"v{new_version}"
        subprocess.run(
            ["git", "-C", repo_root, "tag", "-a", tag_name, "-m", f"Release {new_version}"],
            check=True,
        )
        print(f"Tagged {tag_name}")


if __name__ == "__main__":
    main()
