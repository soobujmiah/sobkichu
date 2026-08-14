#!/usr/bin/env python3
"""Catch the Prettier violations that keep reaching CI.

Not a replacement for Prettier -- it is a cheap local approximation of the
handful of rules that have actually broken builds on this repo, so they get
caught before a push instead of after.

The recurring one: a call wrapped across lines whose arguments would fit on
a single line within printWidth. Prettier joins those, so hand-wrapping them
is a violation.

Run:  python3 tools/prettier_heuristics.py
"""

from __future__ import annotations

import glob
import re
import sys

PRINT_WIDTH = 90
SCAN = ["api/src/**/*.ts", "api/test/**/*.ts"]


def check(path: str) -> list[str]:
    problems: list[str] = []
    src = open(path, encoding="utf-8").read()
    lines = src.split("\n")

    if src and not src.endswith("\n"):
        problems.append(f"{path}: missing trailing newline")
    if "\n\n\n" in src:
        problems.append(f"{path}: consecutive blank lines")

    for i, line in enumerate(lines, start=1):
        if len(line) > PRINT_WIDTH:
            problems.append(f"{path}:{i}: line is {len(line)} > {PRINT_WIDTH}")
        if re.search(r"[ \t]+$", line):
            problems.append(f"{path}:{i}: trailing whitespace")

    # A call opened at end of line, one argument, closed on a later line.
    # If the joined form fits, Prettier collapses it.
    for i in range(len(lines) - 2):
        opener = lines[i].rstrip()
        middle = lines[i + 1].strip()
        closer = lines[i + 2].strip()

        if not opener.endswith("("):
            continue
        if closer not in (");", "),", ")", ");,"):
            continue
        if not middle or middle.endswith(("{", "(", "[")):
            continue
        if "//" in middle or middle.startswith("*"):
            continue

        arg = middle.rstrip(",")
        joined = f"{opener}{arg}{closer}"
        if len(joined) <= PRINT_WIDTH:
            problems.append(
                f"{path}:{i + 1}: wrapped call fits on one line "
                f"({len(joined)} chars) -- Prettier will join it"
            )

    return problems


def main() -> int:
    files: list[str] = []
    for pattern in SCAN:
        files.extend(glob.glob(pattern, recursive=True))

    if not files:
        print("prettier heuristics: no TypeScript files yet.")
        return 0

    problems: list[str] = []
    for path in sorted(files):
        problems.extend(check(path))

    for problem in problems:
        print(f"FAIL   {problem}")

    print(
        f"\nprettier heuristics: {len(files)} file(s), {len(problems)} likely issue(s)."
    )

    if problems:
        print("\nThese are approximations of Prettier's rules, not Prettier itself.")
        print("Authoritative fix: npm run lint -- --fix")
        return 1

    print("No likely Prettier issues.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
