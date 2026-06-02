import argparse
import ast
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

TEMPLATES_DIR = Path(__file__).resolve().parent / "buildfiles" / "templates"

JS_IMPORT_RE = re.compile(
    r"""(?:from|import)\s+['"](\.[^'"]+)['"]|require\s*\(\s*['"](\.[^'"]+)['"]\s*\)|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)"""
)
JS_EXTENSIONS = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"}


def log(msg):
    print(f"[build] {msg}", flush=True)


def fatal(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def slug_to_pascal(slug):
    return "".join(part.capitalize() for part in re.split(r"[-_]+", slug) if part)


def path_is_inside(parent, child):
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def load_template(name):
    path = TEMPLATES_DIR / name
    if not path.is_file():
        fatal(f"Missing template file: {path}")
    return path.read_text(encoding="utf-8")


def write_template(dest_path, template_name, **substitutions):
    text = load_template(template_name)
    for key, val in substitutions.items():
        text = text.replace(f"@@{key}@@", val)
    dest_path.write_text(text, encoding="utf-8")


def _is_stdlib_module(name):
    root = name.split(".")[0]
    return root in getattr(sys, "stdlib_module_names", set()) or root in getattr(
        sys, "builtin_module_names", ()
    )


def _module_paths(name):
    try:
        spec = importlib.util.find_spec(name)
    except (ImportError, ModuleNotFoundError, ValueError):
        return []
    if spec is None:
        return []

    paths = []
    if spec.origin and spec.origin != "built-in":
        paths.append(Path(spec.origin).resolve())
    for loc in getattr(spec, "submodule_search_locations", None) or []:
        if loc:
            paths.append(Path(loc).resolve())
    return paths


def _check_absolute_import(
    module_name, plugin_root, plugins_root, problems, check_packages=True
):
    if not check_packages:
        return

    if _is_stdlib_module(module_name):
        return

    stdlib_base = Path(sys.base_prefix).resolve()

    for loc in _module_paths(module_name):
        if path_is_inside(plugin_root, loc) or path_is_inside(plugins_root, loc):
            continue
        in_stdlib = path_is_inside(stdlib_base / "lib", loc) or path_is_inside(
            stdlib_base, loc
        )
        in_site = "site-packages" in loc.parts or "dist-packages" in loc.parts
        if in_stdlib or in_site:
            continue
        problems.append(f"{module_name} resolves outside backend plugins tree: {loc}")


def check_python_imports(plugin_root, check_packages=True):
    plugin_root = plugin_root.resolve()
    plugins_root = plugin_root.parent.resolve()
    problems = []

    for py_file in sorted(plugin_root.rglob("*.py")):
        if "__pycache__" in py_file.parts:
            continue

        try:
            tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
        except SyntaxError as e:
            problems.append(f"{py_file}: syntax error: {e}")
            continue

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    _check_absolute_import(
                        alias.name.split(".")[0],
                        plugin_root,
                        plugins_root,
                        problems,
                        check_packages,
                    )

            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    anchor = py_file.parent
                    for _ in range(node.level - 1):
                        anchor = anchor.parent

                    rel = (node.module or "").replace(".", os.sep)
                    candidate = anchor / rel if rel else anchor
                    resolved = None
                    for probe in [
                        candidate / "__init__.py",
                        candidate,
                        Path(str(anchor / rel) + ".py"),
                    ]:
                        if probe.exists():
                            resolved = probe.resolve()
                            break

                    if (
                        resolved
                        and not path_is_inside(plugin_root, resolved)
                        and not path_is_inside(plugins_root, resolved)
                    ):
                        problems.append(
                            f"{py_file}: relative import escapes plugin tree "
                            f"(level={node.level}, module={node.module!r}) -> {resolved}"
                        )
                elif node.module:
                    _check_absolute_import(
                        node.module.split(".")[0],
                        plugin_root,
                        plugins_root,
                        problems,
                        check_packages,
                    )

    if problems:
        fatal(
            "Backend references modules outside local-cli-backend/plugins:\n"
            + "\n".join(f"  - {p}" for p in problems)
        )


def check_js_imports(plugin_fe_root, check_packages):
    plugin_fe_root = plugin_fe_root.resolve()
    problems = []

    for f in sorted(plugin_fe_root.rglob("*")):
        if not f.is_file() or f.suffix.lower() not in JS_EXTENSIONS:
            continue
        if "node_modules" in f.parts or f.name == "devContext.js":
            continue

        for line_num, line in enumerate(
            f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1
        ):
            for match in JS_IMPORT_RE.finditer(line):
                rel = next(g for g in match.groups() if g)
                base = (f.parent / rel).resolve()

                resolved = None
                for probe in [
                    base,
                    *(Path(str(base) + ext) for ext in (".js", ".jsx", ".json")),
                ]:
                    if probe.exists():
                        resolved = probe
                        break

                if resolved and not path_is_inside(plugin_fe_root, resolved):
                    problems.append(
                        f"{f}:{line_num}: {rel!r} resolves outside plugin -> {resolved}"
                    )

    if problems:
        fatal(
            "Frontend imports reference paths outside the plugin folder:\n"
            + "\n".join(f"  - {p}" for p in problems)
        )


def find_router_module(plugin_dir, plugin_slug):
    router_files = sorted(plugin_dir.glob("*_router.py"))
    if not router_files:
        fatal(f"No '*_router.py' found under {plugin_dir}.")

    def has_api_router(path):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError:
            return False
        for node in tree.body:
            if isinstance(node, ast.Assign):
                if any(
                    isinstance(t, ast.Name) and t.id == "api_router"
                    for t in node.targets
                ):
                    return True
            if isinstance(node, ast.AnnAssign):
                if isinstance(node.target, ast.Name) and node.target.id == "api_router":
                    return True
        return False

    valid = [p for p in router_files if has_api_router(p)]
    if not valid:
        fatal(
            f"No '*_router.py' under {plugin_dir} declares a module-level `api_router`."
        )

    preferred = plugin_dir / f"{plugin_slug}_router.py"
    chosen = preferred if preferred in valid else valid[0]
    return chosen, chosen.stem


def find_page_entry(src_dir, plugin_slug):
    pages = sorted(src_dir.glob("*Page.js")) + sorted(src_dir.glob("*Page.jsx"))
    if not pages:
        fatal(f"No *Page.js / *Page.jsx found under {src_dir}.")

    pascal = slug_to_pascal(plugin_slug)
    for suffix in (".js", ".jsx"):
        candidate = src_dir / f"{pascal}Page{suffix}"
        if candidate.is_file():
            return candidate

    if len(pages) == 1:
        return pages[0]

    fatal(
        f"Multiple page components found: {', '.join(p.name for p in pages)}. "
        f"Rename one to XPage.js/jsx or {pascal}Page.js/jsx."
    )


def find_fe_plugin_dir(fe_root, plugin_slug):
    for candidate in [
        fe_root / "plugins" / plugin_slug,
        fe_root / "src" / "plugins" / plugin_slug,
    ]:
        if candidate.is_dir():
            return candidate.resolve()
    fatal(f"Frontend plugin folder not found for {plugin_slug!r} under {fe_root}.")


def write_backend_extras(backend_dir, router_mod):
    main_py = backend_dir / "main.py"
    if main_py.is_file():
        log("main.py already exists, leaving it alone.")
        return
    write_template(main_py, "main.py.template", ROUTER_MODULE=router_mod)
    log("Created main.py from template.")


def write_frontend_extras(frontend_dir, src_dir, plugin_slug, page_path):
    write_template(
        frontend_dir / "index.html", "index.html.template", PLUGIN=plugin_slug
    )
    write_template(frontend_dir / "config.js", "config.js")
    write_template(
        frontend_dir / "vite.config.js",
        "vite.config.js.template",
        PLUGIN=plugin_slug,
        EXPOSE_PATH=f"./src/{page_path.name}",
        EXPOSE_MODULE=f"{page_path.name}",
    )

    for stale in src_dir.rglob("pluginHost.js"):
        stale.unlink()
        log(f"Removed stale {stale.name}")

    bridge_code = load_template("pluginHost.js")
    bridge_targets = {src_dir / "devContext.js"} | set(src_dir.rglob("devContext.js"))
    for target in sorted(bridge_targets):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(bridge_code, encoding="utf-8")
        log(f"Wrote host bridge -> {target.relative_to(src_dir)}")

    write_template(
        src_dir / "main.js", "main.js.template", PAGE_BASENAME=page_path.stem
    )


def generate_requirements(backend_dir):
    attempts = [
        [sys.executable, "-m", "pipreqs", ".", "--force", "--encoding", "utf-8"],
        ["pipreqs", ".", "--force", "--encoding", "utf-8"],
        [
            sys.executable,
            "-m",
            "pigar",
            "generate",
            "-f",
            "requirements.txt",
            "-p",
            ".",
        ],
        ["pigar", "generate", "-f", "requirements.txt", "-p", "."],
    ]
    for cmd in attempts:
        try:
            result = subprocess.run(
                cmd, cwd=backend_dir, capture_output=True, text=True
            )
        except FileNotFoundError:
            continue
        if result.returncode == 0 and (backend_dir / "requirements.txt").is_file():
            log(f"requirements.txt written via {cmd[0]}")
            return
    fatal("Could not generate requirements.txt — install pipreqs or pigar and retry.")


def zip_bundle(output_dir, plugin_slug):
    zip_path = output_dir / f"{plugin_slug}-plugin.zip"
    log(f"Zipping -> {zip_path.name}")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for subtree in (output_dir / "backend", output_dir / "frontend"):
            if not subtree.is_dir():
                fatal(f"Cannot zip: missing {subtree.name}/ folder at {subtree}")
            for path in sorted(subtree.rglob("*")):
                if path.is_file():
                    zf.write(path, path.relative_to(output_dir).as_posix())
    log(f"Archive ready: {zip_path}")
    return zip_path


def main():
    script_dir = Path(__file__).resolve().parent
    cli_root = script_dir.parent

    parser = argparse.ArgumentParser(description="Build a CLI plugin bundle.")
    parser.add_argument("--plugin", required=True, help="Plugin slug (folder name).")
    parser.add_argument(
        "--output",
        default=None,
        help="Output directory (default: CLI/built-plugins/<plugin>).",
    )

    parser.add_argument(
        "--skip-be-package-check",
        action="store_true",
        help="Skip installed package validation for backend Python imports.",
    )

    parser.add_argument(
        "--skip-fe-package-check",
        action="store_true",
        help="Skip installed package validation for frontend JS imports.",
    )
    parser.add_argument(
        "--skip-all-package-check",
        action="store_true",
        help="Skip installed package validation for both backend and frontend.",
    )

    parser.add_argument(
        "--skip-be-checks",
        action="store_true",
        help="Skips all validation for backend.",
    )

    parser.add_argument(
        "--skip-fe-checks",
        action="store_true",
        help="Skips all validation for backend.",
    )

    args = parser.parse_args()

    skip_be = args.skip_be_package_check or args.skip_all_package_check
    skip_fe = args.skip_fe_package_check or args.skip_all_package_check

    plugin = args.plugin.strip()
    if not plugin:
        fatal("--plugin must be non-empty")

    output_dir = (
        Path(args.output).expanduser().resolve()
        if args.output
        else cli_root / "built-plugins" / plugin
    )
    backend_src = script_dir / "plugins" / plugin
    fe_root = cli_root / "local-cli-fe-full"

    log(f"Plugin: {plugin!r}   Output: {output_dir}")

    if not backend_src.is_dir():
        fatal(f"Backend plugin folder not found: {backend_src}")

    if not args.skip_be_checks:
        log("Checking Python imports...")
        check_python_imports(backend_src, check_packages=not skip_be)

    log("Finding router module...")
    router_path, router_mod = find_router_module(backend_src, plugin)
    log(f"Router: {router_path.name}  (module: {router_mod!r})")

    log("Resolving frontend plugin directory...")
    fe_plugin = find_fe_plugin_dir(fe_root, plugin)

    if not args.skip_fe_checks:
        log("Checking JS imports...")
        check_js_imports(fe_plugin, check_packages=not skip_fe)

    backend_dest = output_dir / "backend"
    if backend_dest.exists():
        shutil.rmtree(backend_dest)
    output_dir.mkdir(parents=True, exist_ok=True)
    shutil.copytree(backend_src, backend_dest)
    log(f"Copied backend -> {backend_dest}")

    log("Generating requirements.txt...")
    generate_requirements(backend_dest)
    write_backend_extras(backend_dest, router_mod)

    frontend_dir = output_dir / "frontend"
    if frontend_dir.exists():
        shutil.rmtree(frontend_dir)
    frontend_dir.mkdir()

    pkg_json = fe_root / "package.json"
    if not pkg_json.is_file():
        fatal(f"Missing package.json at {pkg_json}")
    shutil.copy2(pkg_json, frontend_dir / "package.json")

    src_dir = frontend_dir / "src"
    src_dir.mkdir()
    for entry in fe_plugin.iterdir():
        dest = src_dir / entry.name
        if entry.is_dir():
            shutil.copytree(entry, dest)
        else:
            shutil.copy2(entry, dest)
    log(f"Copied frontend source -> {src_dir}")

    page_path = find_page_entry(src_dir, plugin)
    log(f"Page entry: {page_path.name}")
    write_frontend_extras(frontend_dir, src_dir, plugin, page_path)

    zip_path = zip_bundle(output_dir, plugin)

    print(f"\nDone!\n  Output:  {output_dir}\n  Archive: {zip_path}\n", flush=True)


if __name__ == "__main__":
    main()
