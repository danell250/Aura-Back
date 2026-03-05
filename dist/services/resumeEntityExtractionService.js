"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferResumeName = exports.extractResumeEmail = void 0;
const extractResumeEmail = (text) => {
    const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return (match === null || match === void 0 ? void 0 : match[0]) ? match[0].toLowerCase() : null;
};
exports.extractResumeEmail = extractResumeEmail;
const inferResumeName = (text) => {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 12);
    for (const line of lines) {
        if (line.length < 3 || line.length > 80)
            continue;
        if (line.includes('@') || /\d/.test(line))
            continue;
        if (!/^[a-zA-Z][a-zA-Z\s.'-]+$/.test(line))
            continue;
        const words = line.split(/\s+/);
        if (words.length < 2 || words.length > 4)
            continue;
        return line;
    }
    return null;
};
exports.inferResumeName = inferResumeName;
