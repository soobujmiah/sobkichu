#!/usr/bin/env python3
"""Internal Markdown link checker.

The repo is the single source of truth (master prompt Section 4) and a lot
of the compliance reasoning lives only in docs/. Broken cross-references rot
that quietly, so this runs in CI.

Checks relative links and anchors between Markdown files. External URLs are
deliberately not fetched -- network flakiness must never redden a docs build.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(".")
SKIP_DIRS = {".git", "node_modules", "build", ".dart_tool", ".venv"}

LINK = re.compile(r"\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
ATX_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*$", re.MULTILINE)


def slugify(heading: str) -> str:
    """GitHub's heading -> anchor rule, near enough for our purposes."""
    text = re.sub(r"`([^`]*)`", r"\1", heading)          # strip code spans
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)  # links -> text
    text = re.sub(r"[*_~]", "", text)                     # emphasis
    text = text.strip().lower()
    text = re.sub(r"[^\w\s\-\u0980-\u09FF]", "", text)    # keep Bangla
    return re.sub(r"[\s]+", "-", text)


def anchors_for(path: Path) -> set[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return set()
    found: set[str] = set()
    for _, heading in ATX_HEADING.findall(text):
        slug = slugify(heading)
        if not slug:
            continue
        # GitHub disambiguates repeats with -1, -2, ...
        if slug in found:
            n = 1
            while f"{slug}-{n}" in found:
                n += 1
            found.add(f"{slug}-{n}")
        else:
            found.add(slug)
    return found


def markdown_files() -> list[Path]:
    return sorted(
        p for p in ROOT.rglob("*.md")
        if not any(part in SKIP_DIRS for part in p.parts)
    )


def main() -> int:
    files = markdown_files()
    if not files:
        print("link check: no Markdown files found.")
        return 0

    anchor_cache: dict[Path, set[str]] = {}
    errors: list[str] = []
    checked = 0

    for path in files:
        text = path.read_text(encoding="utf-8")
        base = path.parent

        for label, target in LINK.findall(text):
            if target.startswith(("http://", "https://", "mailto:", "tel:")):
                continue          # external: never fetched
            if target.startswith("<") or "${" in target:
                continue          # template placeholder

            checked += 1
            file_part, _, anchor = target.partition("#")

            if not file_part:                       # same-file anchor
                resolved = path
            else:
                resolved = (base / file_part).resolve()
                try:
                    resolved.relative_to(Path.cwd())
                except ValueError:
                    errors.append(f"{path}: '{target}' escapes the repo")
                    continue
                if not resolved.exists():
                    errors.append(f"{path}: broken link [{label}] -> {target}")
                    continue

            if anchor and resolved.suffix == ".md":
                if resolved not in anchor_cache:
                    anchor_cache[resolved] = anchors_for(resolved)
                if anchor.lower() not in anchor_cache[resolved]:
                    errors.append(
                        f"{path}: missing anchor '#{anchor}' in {file_part or path.name}"
                    )

    for line in errors:
        print(f"FAIL   {line}")

    print(f"\nlink check: {len(files)} file(s), {checked} internal link(s), {len(errors)} broken.")
    if errors:
        print("\nThe repo is the source of truth; broken cross-references rot it.")
        return 1

    print("All internal links resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
