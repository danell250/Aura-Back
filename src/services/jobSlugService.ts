import { readString } from '../utils/inputSanitizers';

export const normalizeJobSlugValue = (value: unknown, maxLength = 220): string => {
  const raw = readString(String(value || ''), maxLength)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!raw) return '';
  return raw
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};
