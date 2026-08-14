/**
 * Message rendering.
 *
 * Composes a notification from a translation key, the recipient's language
 * and a parameter map.
 *
 * Templates load from locales/ at startup rather than living in this file.
 * An earlier version inlined the Bangla strings here, which
 * tools/hardcoded_string_check.py correctly rejected -- hardcoded Bangla is
 * the same bug as hardcoded English (docs/localization/i18n-conventions.md).
 * Keeping them in locales/ also means tools/i18n_check.py can verify Bangla
 * coverage, which it cannot do for strings buried in TypeScript.
 *
 * Bangla-first: `bn` is the source of truth AND the fallback. Falling back
 * to English would quietly serve English to a Bangla speaker.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RenderedMessage {
  readonly title: string;
  readonly body: string;
}

interface Template {
  readonly title: string;
  readonly body: string;
}

const SOURCE_LOCALE = 'bn';
const LOCALES = [SOURCE_LOCALE, 'en'] as const;

/** locales/ sits at the repo root, one level above api/. */
function localesDir(): string {
  return process.env.LOCALES_DIR ?? join(__dirname, '../../../../locales');
}

/** Flatten nested JSON into dotted keys, matching tools/i18n_check.py. */
function flatten(
  value: Record<string, unknown>,
  prefix: string,
  out: Record<string, unknown>,
): void {
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
      flatten(nested as Record<string, unknown>, path, out);
    } else {
      out[path] = nested;
    }
  }
}

/**
 * Loaded once at module init. Notification volume makes a per-send disk read
 * wasteful, and the bundles are immutable at runtime.
 */
const TEMPLATES: Record<string, Record<string, Template>> = loadTemplates();

function loadTemplates(): Record<string, Record<string, Template>> {
  const templates: Record<string, Record<string, Template>> = {};

  for (const locale of LOCALES) {
    const path = join(localesDir(), locale, 'notification.json');

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      if (locale === SOURCE_LOCALE) {
        // Bangla is mandatory. Missing it is a deployment error, not a
        // reason to fall through to English.
        throw new Error(
          `Cannot load required ${SOURCE_LOCALE} notification templates from ${path}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
      continue;
    }

    const flat: Record<string, unknown> = {};
    flatten(parsed, '', flat);

    // 'order.confirmed.title' -> key 'notification.order.confirmed'
    for (const [dotted, value] of Object.entries(flat)) {
      const match = /^(.*)\.(title|body)$/.exec(dotted);
      if (!match || typeof value !== 'string') {
        continue;
      }

      const key = `notification.${match[1]}`;
      const field = match[2] as 'title' | 'body';

      templates[key] ??= {};
      const existing = (templates[key][locale] ?? { title: '', body: '' }) as {
        title: string;
        body: string;
      };
      templates[key][locale] = { ...existing, [field]: value };
    }
  }

  return templates;
}

export class MissingTemplateError extends Error {}

export function renderTemplate(
  templateKey: string,
  language: string,
  params: Record<string, string>,
): RenderedMessage {
  const byLanguage = TEMPLATES[templateKey];

  if (!byLanguage) {
    throw new MissingTemplateError(`No template for key: ${templateKey}`);
  }

  const template = byLanguage[language] ?? byLanguage[SOURCE_LOCALE];

  if (!template) {
    throw new MissingTemplateError(
      `Template ${templateKey} has no '${SOURCE_LOCALE}' entry to fall back to`,
    );
  }

  return {
    title: substitute(template.title, params),
    body: substitute(template.body, params),
  };
}

/**
 * Replace {placeholders}.
 *
 * An unmatched placeholder throws rather than shipping a literal "{amount}"
 * to a user -- for a payment confirmation that is worse than no message.
 */
function substitute(text: string, params: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];

    if (value === undefined) {
      throw new MissingTemplateError(`Missing parameter '${key}' for notification`);
    }

    return value;
  });
}

/** Template keys loaded from the bundles. Used to assert policy coverage. */
export function knownTemplateKeys(): string[] {
  return Object.keys(TEMPLATES);
}
