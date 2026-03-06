import { readString } from './inputSanitizers';

export const normalizeExternalUrl = (value: unknown, maxLength = 600): string | null => {
  const raw = readString(String(value || ''), maxLength);
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

export const normalizeEmailAddress = (value: unknown, maxLength = 200): string | null => {
  const raw = readString(String(value || ''), maxLength).toLowerCase();
  if (!raw) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null;
  return raw;
};
