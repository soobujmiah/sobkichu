#!/usr/bin/env python3
"""Join multi-line import braces that fit within printWidth.

Applies the fix that tools/prettier_heuristics.py only reports. Narrow on
purpose: it touches nothing but import statements, so it cannot alter logic.

Run:  python3 tools/fix_imports.py
"""

from __future__ import annotations

import glob
import re
import sys

PRINT_WIDTH = 90
SCAN = ["api/src/**/*.ts", "api/test/**/*.ts"]


def fix(path: str) -> int:
    lines = open(path, encoding="utf-8").read().split("\n")
    out: list[str] = []
    fixed = 0
    i = 0

    while i < len(lines):
        if re.match(r"^import\s*\{\s*$", lines[i].strip()):
            names: list[str] = []
            j = i + 1
            while j < len(lines) and "}" not in lines[j]:
                names.append(lines[j].strip().rstrip(","))
                j += 1

            if j < len(lines) and names:
                tail = lines[j].strip()
                joined = f"import {{ {', '.join(names)} {tail}"
                if len(joined) <= PRINT_WIDTH:
                    out.append(joined)
                    fixed += 1
                    i = j + 1
                    continue

            out.extend(lines[i : j + 1])
            i = j + 1
            continue

        out.append(lines[i])
        i += 1

    if fixed:
        open(path, "w", encoding="utf-8").write("\n".join(out))

    return fixed


def main() -> int:
    files: list[str] = []
    for pattern in SCAN:
        files.extend(glob.glob(pattern, recursive=True))

    total = 0
    for path in sorted(files):
        count = fix(path)
        if count:
            print(f"  fixed {count} import(s) in {path}")
            total += count

    print(f"\nfix_imports: {total} import(s) joined.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
