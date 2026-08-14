#!/usr/bin/env python3
"""Translation key coverage check.

Enforces docs/localization/i18n-conventions.md:

  1. Bangla ('bn') is the source of truth. Every key present in any locale
     must exist in bn.
  2. Keys under LEGAL_PREFIXES must exist in bn -- this is compliance row C6
     (Digital Commerce Operation Guidelines 2021: refund / return / delivery
     terms must be displayed in Bangla). A missing bn legal key is a build
     failure, not a warning.
  3. Ordinary UI keys missing from a secondary locale are warnings.

No-ops cleanly when locales/ does not exist yet, so this runs from day one.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

LOCALES_DIR = Path("locales")
SOURCE_LOCALE = "bn"

# Missing bn for these prefixes fails the build. Showing English legal terms
# to a Bangla speaker is the thing DCOG 2021 prohibits.
LEGAL_PREFIXES = ("legal.", "checkout.terms.")


def flatten(obj, prefix: str = "") -> dict[str, str]:
    """Flatten nested JSON into dotted keys."""
    out: dict[str, str] = {}
    for key, value in obj.items():
        path = f"{prefix}{key}"
        if isinstance(value, dict):
            out.update(flatten(value, f"{path}."))
        else:
            out[path] = value
    return out


def load_locale(locale_dir: Path) -> dict[str, str]:
    """Load and merge every JSON bundle in a locale directory."""
    keys: dict[str, str] = {}
    for path in sorted(locale_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"ERROR  {path}: invalid JSON -- {exc}")
            sys.exit(1)
        namespace = path.stem
        for key, value in flatten(data).items():
            keys[f"{namespace}.{key}"] = value
    return keys


def is_legal(key: str) -> bool:
    return key.startswith(LEGAL_PREFIXES)


def main() -> int:
    if not LOCALES_DIR.is_dir():
        print("i18n check: locales/ not present yet -- nothing to verify.")
        print("            This check activates as soon as translation bundles land.")
        return 0

    locale_dirs = sorted(d for d in LOCALES_DIR.iterdir() if d.is_dir())
    if not locale_dirs:
        print("i18n check: no locale directories under locales/ -- nothing to verify.")
        return 0

    locales = {d.name: load_locale(d) for d in locale_dirs}

    if SOURCE_LOCALE not in locales:
        print(f"FAIL   Source locale '{SOURCE_LOCALE}' is missing.")
        print("       Bangla is the source of truth, not a translation target.")
        return 1

    source = locales[SOURCE_LOCALE]
    all_keys: set[str] = set()
    for keys in locales.values():
        all_keys |= set(keys)

    errors: list[str] = []
    warnings: list[str] = []

    # Empty bn values are as bad as missing ones.
    for key, value in sorted(source.items()):
        if not str(value).strip():
            target = errors if is_legal(key) else warnings
            target.append(f"{SOURCE_LOCALE}: '{key}' is empty")

    # Every key used anywhere must exist in bn.
    for key in sorted(all_keys - set(source)):
        if is_legal(key):
            errors.append(f"LEGAL key '{key}' missing from '{SOURCE_LOCALE}' (compliance C6)")
        else:
            errors.append(f"Key '{key}' missing from source locale '{SOURCE_LOCALE}'")

    # Secondary locales: gaps are warnings, fallback is acceptable for UI.
    for name, keys in sorted(locales.items()):
        if name == SOURCE_LOCALE:
            continue
        for key in sorted(set(source) - set(keys)):
            warnings.append(f"{name}: missing '{key}' (falls back to {SOURCE_LOCALE})")

    for line in warnings:
        print(f"WARN   {line}")
    for line in errors:
        print(f"FAIL   {line}")

    total = len(all_keys)
    print(
        f"\ni18n check: {total} keys across {len(locales)} locales -- "
        f"{len(errors)} error(s), {len(warnings)} warning(s)."
    )

    if errors:
        print("\nBangla coverage is a compliance requirement, not a nicety.")
        print("See docs/localization/i18n-conventions.md and compliance row C6.")
        return 1

    print("Bangla coverage OK.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
