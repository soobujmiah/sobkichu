#!/usr/bin/env python3
"""Hardcoded user-facing string check.

Enforces master prompt Section 10.7 and docs/localization/i18n-conventions.md:
every user-facing string routes through a translation key.

The rule cuts both ways. Hardcoded Bangla is the SAME bug as hardcoded
English -- it feels right in a Bangla-first product, but it strands the
English fallback and breaks the moment the string needs to vary.

Deliberately conservative: it flags display widgets whose literal text is
prose, and any Bangla-script literal in source. It is a tripwire for the
obvious cases, not a substitute for review.

No-ops cleanly when mobile/ and api/ do not exist yet.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SCAN_DIRS = [Path("mobile/lib"), Path("api/src")]

# Bangla (Bengali) Unicode block.
BANGLA = re.compile(r"[\u0980-\u09FF]")

# Flutter display widgets taking a literal first argument.
DART_DISPLAY = re.compile(
    r"""\b(?:Text|SelectableText|TextSpan\s*\(\s*text:|Tooltip\s*\(\s*message:)\s*\(?\s*(['"])([^'"\n]+?)\1"""
)

# NestJS user-facing exception messages.
TS_EXCEPTION = re.compile(
    r"""\bthrow\s+new\s+\w*(?:Exception|Error)\s*\(\s*(['"`])([^'"`\n]+?)\1"""
)

ALLOW_COMMENT = "i18n-ignore"

# Not prose: identifiers, keys, symbols, numbers, single words in code style.
LOOKS_LIKE_KEY = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)+$")
NOT_PROSE = re.compile(r"^[\s\W\d]*$")


def is_prose(text: str) -> bool:
    """Heuristic: does this literal look like something a user reads?"""
    stripped = text.strip()
    if not stripped or NOT_PROSE.match(stripped):
        return False
    if LOOKS_LIKE_KEY.match(stripped):
        return False          # already a translation key
    if BANGLA.search(stripped):
        return True           # hardcoded Bangla is still hardcoded
    # English: two or more words, or one long word, reads as prose.
    words = re.findall(r"[A-Za-z]{2,}", stripped)
    return len(words) >= 2 or (len(words) == 1 and len(words[0]) >= 8)


def scan_file(path: Path) -> list[tuple[int, str, str]]:
    findings: list[tuple[int, str, str]] = []
    try:
        source = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return findings

    lines = source.splitlines()
    patterns = [DART_DISPLAY] if path.suffix == ".dart" else [TS_EXCEPTION]

    for pattern in patterns:
        for match in pattern.finditer(source):
            literal = match.group(2)
            if not is_prose(literal):
                continue
            line_no = source[: match.start()].count("\n") + 1
            line = lines[line_no - 1] if line_no <= len(lines) else ""
            if ALLOW_COMMENT in line:
                continue
            kind = "Bangla" if BANGLA.search(literal) else "English"
            findings.append((line_no, kind, literal.strip()[:70]))

    # Any Bangla literal anywhere in source, even outside a display widget.
    for line_no, line in enumerate(lines, start=1):
        if ALLOW_COMMENT in line or line.lstrip().startswith(("//", "*", "#")):
            continue
        for quoted in re.findall(r"""(['"`])(.*?)\1""", line):
            literal = quoted[1]
            if (
                BANGLA.search(literal)
                and is_prose(literal)
                and not any(f[0] == line_no for f in findings)
            ):
                findings.append((line_no, "Bangla", literal.strip()[:70]))

    return findings


def main() -> int:
    targets = [d for d in SCAN_DIRS if d.is_dir()]
    if not targets:
        print("hardcoded string check: no source directories yet -- nothing to scan.")
        print("                        Activates when mobile/lib or api/src lands.")
        return 0

    total = 0
    scanned = 0
    for directory in targets:
        for path in sorted(directory.rglob("*")):
            if path.suffix not in (".dart", ".ts"):
                continue
            if any(part in {"generated", "node_modules", ".dart_tool"} for part in path.parts):
                continue
            if path.name.endswith((".g.dart", ".freezed.dart", ".spec.ts", ".test.ts")):
                continue
            scanned += 1
            for line_no, kind, literal in scan_file(path):
                print(f"FAIL   {path}:{line_no}  hardcoded {kind}: \"{literal}\"")
                total += 1

    print(f"\nhardcoded string check: {scanned} file(s) scanned, {total} finding(s).")

    if total:
        print("\nEvery user-facing string must route through a translation key.")
        print("Hardcoded Bangla is the same bug as hardcoded English.")
        print(f"Genuine exceptions: add a '{ALLOW_COMMENT}' comment on the line.")
        print("See docs/localization/i18n-conventions.md")
        return 1

    print("No hardcoded user-facing strings found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
