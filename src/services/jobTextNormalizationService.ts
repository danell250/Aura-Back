import { readString } from '../utils/inputSanitizers';

const HTML_BREAK_TAG_REGEX = /<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi;
const HTML_LIST_ITEM_TAG_REGEX = /<li\b[^>]*>/gi;
const HTML_TAG_REGEX = /<[^>]+>/g;
const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g;
const MULTI_WHITESPACE_REGEX = /[ \t\f\v]+/g;
const MULTI_NEWLINE_REGEX = /\n{3,}/g;
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#34;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#160;': ' ',
  '&middot;': '·',
  '&ndash;': '-',
  '&mdash;': '-',
  '&hellip;': '...',
};
const HTML_ENTITY_REGEX = /&(?:amp|lt|gt|quot|#34|#39|apos|nbsp|#160|middot|ndash|mdash|hellip);/gi;
const NUMERIC_HTML_ENTITY_REGEX = /&#(x?[0-9a-f]+);/gi;
const QUICK_HTML_REGEX = /<|&[#a-z0-9]+;|\u00e2\u0080|\u00c2|[\u0000-\u001F\u007F]/i;
const MOJIBAKE_FIXUPS: Array<[RegExp, string]> = [
  [/\u00e2\u0080\u0099/g, "'"],
  [/\u00e2\u0080\u0098/g, "'"],
  [/\u00e2\u0080\u009c/g, '"'],
  [/\u00e2\u0080\u009d/g, '"'],
  [/\u00e2\u0080\u0093/g, '-'],
  [/\u00e2\u0080\u0094/g, '-'],
  [/\u00e2\u0080\u00a6/g, '...'],
  [/\u00c2 /g, ' '],
  [/\u00c2/g, ''],
];

const decodeNumericHtmlEntity = (_match: string, entityBody: string): string => {
  const normalized = String(entityBody || '').trim().toLowerCase();
  if (!normalized) return '';
  const codePoint = normalized.startsWith('x')
    ? Number.parseInt(normalized.slice(1), 16)
    : Number.parseInt(normalized, 10);
  if (!Number.isFinite(codePoint) || codePoint <= 0) {
    return '';
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return '';
  }
};

const decodeBasicHtmlEntities = (value: string): string =>
  value
    .replace(HTML_ENTITY_REGEX, (entity) => HTML_ENTITY_MAP[entity.toLowerCase()] ?? entity)
    .replace(NUMERIC_HTML_ENTITY_REGEX, decodeNumericHtmlEntity);

const repairCommonMojibake = (value: string): string => {
  let next = value;
  for (const [pattern, replacement] of MOJIBAKE_FIXUPS) {
    next = next.replace(pattern, replacement);
  }
  return next;
};

export const normalizeJobText = (value: unknown, maxLength = 15000): string => {
  const raw = readString(value, maxLength);
  if (!raw) return '';

  let normalized = raw;

  if (QUICK_HTML_REGEX.test(raw)) {
    if (raw.includes('&')) {
      normalized = decodeBasicHtmlEntities(normalized);
    }
    if (normalized.includes('<!--')) {
      normalized = normalized.replace(HTML_COMMENT_REGEX, ' ');
    }
    if (normalized.includes('<')) {
      normalized = normalized
        .replace(HTML_BREAK_TAG_REGEX, '\n')
        .replace(HTML_LIST_ITEM_TAG_REGEX, '\n- ')
        .replace(HTML_TAG_REGEX, ' ');
    }
    if (normalized.includes('\u00e2\u0080') || normalized.includes('\u00c2')) {
      normalized = repairCommonMojibake(normalized);
    }
  }

  return normalized
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHAR_REGEX, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(MULTI_WHITESPACE_REGEX, ' ')
    .replace(MULTI_NEWLINE_REGEX, '\n\n')
    .trim()
    .slice(0, maxLength);
};
