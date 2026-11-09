#!/usr/bin/env python3
"""Make Homebrew's native libraries visible to the managed runtime on macOS.

WeasyPrint loads pango and friends with dlopen. The Python that runs the bundled
scripts does not search Homebrew's lib directory, so PDF reports fail even with
`brew install pango` done. Exporting DYLD_FALLBACK_LIBRARY_PATH in the shell does
not help: the launcher starts through /usr/bin/env, and macOS strips DYLD_*
variables when it runs a protected binary. Setting it in runtime.py's child
environment works, because that process is the runtime's own Python.

Run by build_plugin_branch.sh from the build checkout. Idempotent. It fails
rather than building a plugin without the fix if upstream changes the anchor.

Usage: overlay/patch_runtime.py [path/to/runtime.py]   (default scripts/runtime.py)
"""
import sys

MARKER = "# zen overlay: Homebrew libraries for WeasyPrint"
ANCHOR = '    env["PLAYWRIGHT_BROWSERS_PATH"] = str(status["data_dir"] / "ms-playwright")\n'
BLOCK = f"""    if sys.platform == "darwin":
        {MARKER}
        paths = [p for p in env.get("DYLD_FALLBACK_LIBRARY_PATH", "").split(":") if p]
        for lib in ("/opt/homebrew/lib", "/usr/local/lib"):
            if lib not in paths and os.path.isdir(lib):
                paths.append(lib)
        if paths:
            env["DYLD_FALLBACK_LIBRARY_PATH"] = ":".join(paths)
"""


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "scripts/runtime.py"
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if MARKER in text:
        print(f"{path}: already patched")
        return 0
    if text.count(ANCHOR) != 1 or "\nimport sys\n" not in text:
        print(f"error: {path}: anchor not found; update overlay/patch_runtime.py", file=sys.stderr)
        return 1
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text.replace(ANCHOR, ANCHOR + BLOCK))
    print(f"{path}: patched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
