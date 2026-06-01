#!/usr/bin/env python3
"""
zip_plugin.py — Bundle a plugin's frontend and backend into a single zip archive.

Script lives in:  CLI/local-cli-backend/
Backend plugin:   CLI/local-cli-backend/plugins/<backend_folder>
Frontend plugin:  CLI/local-cli-fe-full/src/plugins/<frontend_folder>

Run it and follow the prompts — no arguments needed.
"""

import sys
import zipfile
from pathlib import Path

# Script lives in CLI/local-cli-backend/, so parent is CLI/
SCRIPT_DIR = Path(__file__).resolve().parent
CLI_DIR = SCRIPT_DIR.parent
BACKEND_BASE = SCRIPT_DIR / "plugins"
FRONTEND_BASE = CLI_DIR / "local-cli-fe-full" / "src" / "plugins"


def add_folder_to_zip(zf: zipfile.ZipFile, folder: Path, arcname_prefix: Path) -> int:
    """Recursively add all files in folder to the zip under arcname_prefix/."""
    count = 0
    for file in sorted(folder.rglob("*")):
        if file.is_file():
            arcname = arcname_prefix / file.relative_to(folder)
            zf.write(file, arcname)
            count += 1
    return count


def main():
    print("=== Plugin Zipper ===\n")

    frontend_folder = input("Frontend folder name: ").strip()
    if not frontend_folder:
        print("Error: frontend folder name cannot be empty.", file=sys.stderr)
        sys.exit(1)

    backend_folder = input("Backend folder name:  ").strip()
    if not backend_folder:
        print("Error: backend folder name cannot be empty.", file=sys.stderr)
        sys.exit(1)

    default_zip = f"{backend_folder}.zip"
    output_input = input(f"Output zip name (leave blank for '{default_zip}'): ").strip()
    output_path = Path(output_input if output_input else default_zip)

    # Ensure .zip extension
    if output_path.suffix.lower() != ".zip":
        output_path = output_path.with_suffix(".zip")

    frontend_path = (FRONTEND_BASE / frontend_folder).resolve()
    backend_path = (BACKEND_BASE / backend_folder).resolve()

    # Validate folders
    errors = []
    if not backend_path.exists() or not backend_path.is_dir():
        errors.append(f"Backend folder not found:  {backend_path}")
    if not frontend_path.exists() or not frontend_path.is_dir():
        errors.append(f"Frontend folder not found: {frontend_path}")

    if errors:
        print()
        for e in errors:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"\nZipping:")
    print(f"  backend  → {backend_path}")
    print(f"  frontend → {frontend_path}")
    print(f"  output   → {output_path.resolve()}\n")

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        be_count = add_folder_to_zip(zf, backend_path, Path("backend"))
        fe_count = add_folder_to_zip(zf, frontend_path, Path("frontend"))

    total = fe_count + be_count
    print(f"Done! {total} files archived ({be_count} backend, {fe_count} frontend).")
    print(f"Saved to: {output_path.resolve()}")


if __name__ == "__main__":
    main()