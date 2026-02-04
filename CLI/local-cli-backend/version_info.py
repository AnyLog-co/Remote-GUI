"""
Remote-GUI version information.

Single source of truth: VERSION file at repository root (semantic version).
Git metadata (commit, date, branch, dirty) is computed when available.
Use get_version_info() for a full dict; use it in API and HTML generation.
"""
import datetime
import os
import re
import subprocess
from typing import Any, Dict, Optional

# Application metadata (not git-derived)
APP_METADATA = {
    "application": "Remote-GUI",
    "author": "AnyLog Team",
    "description": "Remote-GUI for AnyLog / EdgeLake",
    "docs": "https://github.com/AnyLog-co/Remote-GUI",
    "license": "Copyright AnyLog Co.",
}


def _find_repo_root(start_path: Optional[str] = None) -> Optional[str]:
    """Walk up from start_path until we find a directory containing .git."""
    path = os.path.abspath(start_path or os.path.dirname(__file__))
    while path and path != os.path.dirname(path):
        if os.path.isdir(os.path.join(path, ".git")):
            return path
        path = os.path.dirname(path)
    return None


def _read_semantic_version(repo_root: Optional[str]) -> str:
    """Read semantic version from VERSION file in repo root. Default '0.0.0' if missing."""
    if not repo_root:
        return "0.0.0"
    version_file = os.path.join(repo_root, "VERSION")
    if not os.path.isfile(version_file):
        return "0.0.0"
    try:
        with open(version_file, "r", encoding="utf-8") as f:
            line = f.read().strip().splitlines()[0].strip()
            # Allow "1.0.0" or "1.0.0-dev"
            if re.match(r"^[\d]+\.[\d]+\.[\d]+([.-][\w.-]*)?$", line):
                return line
            return "0.0.0"
    except Exception:
        return "0.0.0"


def _git_command(repo_root: str, *args: str) -> Optional[str]:
    """Run git in repo_root with given args; return stripped stdout or None on failure."""
    if not repo_root or not os.path.isdir(os.path.join(repo_root, ".git")):
        return None
    try:
        out = subprocess.run(
            ["git", "-C", repo_root] + list(args),
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if out.returncode == 0 and out.stdout:
            return out.stdout.strip()
        return None
    except (subprocess.SubprocessError, FileNotFoundError):
        return None


def get_version_info() -> Dict[str, Any]:
    """
    Build full version info: semantic version from VERSION file plus git metadata.

    Returns a dict with:
      - version: semantic version string (from VERSION file)
      - commit: short commit hash (e.g. 7 chars)
      - commit_full: full commit hash (or same as commit if short fails)
      - date: last commit date in ISO format (UTC)
      - branch: current branch name or "detached"
      - dirty: True if working tree has uncommitted changes
      - git_available: True if we could read git metadata
      Plus all keys from APP_METADATA (application, author, description, docs, license).
    """
    repo_root = _find_repo_root()
    semantic = _read_semantic_version(repo_root)
    out: Dict[str, Any] = {
        **APP_METADATA,
        "version": semantic,
        "commit": "",
        "commit_full": "",
        "date": "",
        "branch": "",
        "dirty": False,
        "git_available": False,
    }

    if not repo_root:
        return out

    short_hash = _git_command(repo_root, "rev-parse", "--short=7", "HEAD")
    full_hash = _git_command(repo_root, "rev-parse", "HEAD")
    if short_hash:
        out["commit"] = short_hash
        out["commit_full"] = full_hash or short_hash
        out["git_available"] = True

    # Commit date (author date, UTC)
    date_raw = _git_command(repo_root, "log", "-1", "--format=%aI", "HEAD")
    if date_raw:
        try:
            dt = datetime.datetime.fromisoformat(date_raw.replace("Z", "+00:00"))
            out["date"] = dt.strftime("%Y-%m-%d %H:%M:%S UTC")
        except Exception:
            out["date"] = date_raw

    # Branch or "detached"
    branch = _git_command(repo_root, "rev-parse", "--abbrev-ref", "HEAD")
    if branch and branch != "HEAD":
        out["branch"] = branch
    else:
        out["branch"] = "detached"

    # Dirty working tree
    status = _git_command(repo_root, "status", "--porcelain")
    out["dirty"] = bool(status)

    return out


def get_version_display_string() -> str:
    """One-line display string, e.g. '1.0.0 (abc1234, main)' or '1.0.0 (abc1234-dirty, main)'."""
    info = get_version_info()
    parts = [info["version"]]
    if info["commit"]:
        commit_part = info["commit"]
        if info.get("dirty"):
            commit_part += "-dirty"
        parts.append(f"({commit_part}")
        if info.get("branch") and info["branch"] != "detached":
            parts.append(f", {info['branch']})")
        else:
            parts.append(")")
    return " ".join(parts)
