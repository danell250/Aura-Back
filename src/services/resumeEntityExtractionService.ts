export const extractResumeEmail = (text: string): string | null => {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match?.[0] ? match[0].toLowerCase() : null;
};

export const inferResumeName = (text: string): string | null => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 12);

  for (const line of lines) {
    if (line.length < 3 || line.length > 80) continue;
    if (line.includes('@') || /\d/.test(line)) continue;
    if (!/^[a-zA-Z][a-zA-Z\s.'-]+$/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    return line;
  }

  return null;
};
