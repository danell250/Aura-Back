export const safeText = (value: unknown, fallback = 'N/A'): string => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return fallback;
};

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const safeHtmlText = (value: unknown, fallback = 'N/A'): string =>
  escapeHtml(safeText(value, fallback));

export const safeNumber = (value: unknown, digits = 2): string => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return Number(0).toFixed(digits);
  return numberValue.toFixed(digits);
};
