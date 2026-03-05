"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseResumeBuffer = exports.RESUME_SUPPORTED_MIME_TYPES = void 0;
const resumeEntityExtractionService_1 = require("./resumeEntityExtractionService");
const resumeSkillScannerService_1 = require("./resumeSkillScannerService");
exports.RESUME_SUPPORTED_MIME_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
]);
const MAX_RESUME_TEXT_LENGTH = 200000;
const readString = (value, maxLength = 10000) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.trim();
    if (!normalized)
        return '';
    return normalized.slice(0, maxLength);
};
const isPdfParseFn = (candidate) => typeof candidate === 'function';
const resolvePdfParseFn = (pdfParseModule) => {
    const visited = new Set();
    const queue = [
        pdfParseModule,
        pdfParseModule === null || pdfParseModule === void 0 ? void 0 : pdfParseModule.default,
        pdfParseModule === null || pdfParseModule === void 0 ? void 0 : pdfParseModule.pdfParse,
        pdfParseModule === null || pdfParseModule === void 0 ? void 0 : pdfParseModule.parse,
    ];
    while (queue.length > 0) {
        const candidate = queue.shift();
        if (isPdfParseFn(candidate))
            return candidate;
        if (!candidate || typeof candidate !== 'object')
            continue;
        if (visited.has(candidate))
            continue;
        visited.add(candidate);
        const moduleLike = candidate;
        queue.push(moduleLike.default, moduleLike.pdfParse, moduleLike.parse);
    }
    return null;
};
const loadPdfParserFromRequire = () => {
    try {
        // Optional runtime dependency: if unavailable, parsing gracefully falls back.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pdfParseModule = require('pdf-parse');
        return resolvePdfParseFn(pdfParseModule);
    }
    catch (_a) {
        return null;
    }
};
const resolveMammothModule = (candidate) => {
    const moduleLike = (candidate === null || candidate === void 0 ? void 0 : candidate.default) || candidate;
    if (moduleLike && typeof moduleLike.extractRawText === 'function') {
        return moduleLike;
    }
    return null;
};
const loadMammoth = () => {
    try {
        // Optional runtime dependency for DOCX text extraction.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mammothModule = require('mammoth');
        return resolveMammothModule(mammothModule);
    }
    catch (_a) {
        return null;
    }
};
const toResumeParseResult = (fullText, parser) => __awaiter(void 0, void 0, void 0, function* () {
    return {
        fullText,
        email: (0, resumeEntityExtractionService_1.extractResumeEmail)(fullText),
        inferredName: (0, resumeEntityExtractionService_1.inferResumeName)(fullText),
        skills: yield (0, resumeSkillScannerService_1.extractResumeSkills)(fullText),
        parser,
    };
});
const parsePdfText = (fileBuffer) => __awaiter(void 0, void 0, void 0, function* () {
    const pdfParse = loadPdfParserFromRequire();
    if (!pdfParse) {
        return { fullText: '', email: null, inferredName: null, skills: [], parser: 'none' };
    }
    try {
        const parsed = yield pdfParse(fileBuffer);
        const fullText = readString((parsed === null || parsed === void 0 ? void 0 : parsed.text) || '', MAX_RESUME_TEXT_LENGTH);
        return yield toResumeParseResult(fullText, 'pdf-parse');
    }
    catch (error) {
        console.warn('Resume parsing: pdf parse failed', error);
        return { fullText: '', email: null, inferredName: null, skills: [], parser: 'none' };
    }
});
const parseWordText = (fileBuffer) => __awaiter(void 0, void 0, void 0, function* () {
    const mammoth = loadMammoth();
    if (!mammoth) {
        return { fullText: '', email: null, inferredName: null, skills: [], parser: 'none' };
    }
    try {
        const parsed = yield mammoth.extractRawText({ buffer: fileBuffer });
        const fullText = readString((parsed === null || parsed === void 0 ? void 0 : parsed.value) || '', MAX_RESUME_TEXT_LENGTH);
        return yield toResumeParseResult(fullText, 'mammoth');
    }
    catch (error) {
        console.warn('Resume parsing: word parse failed', error);
        return { fullText: '', email: null, inferredName: null, skills: [], parser: 'none' };
    }
});
const parseTextContent = (fileBuffer) => __awaiter(void 0, void 0, void 0, function* () {
    const fullText = readString(fileBuffer.toString('utf-8'), MAX_RESUME_TEXT_LENGTH);
    return yield toResumeParseResult(fullText, 'plaintext');
});
const parseResumeBuffer = (fileBuffer, mimeType) => __awaiter(void 0, void 0, void 0, function* () {
    const normalizedMime = readString(mimeType, 120).toLowerCase();
    if (!fileBuffer || fileBuffer.length === 0) {
        return { fullText: '', email: null, inferredName: null, skills: [], parser: 'none' };
    }
    if (normalizedMime === 'text/plain') {
        return yield parseTextContent(fileBuffer);
    }
    if (normalizedMime === 'application/pdf') {
        return yield parsePdfText(fileBuffer);
    }
    if (normalizedMime === 'application/msword' ||
        normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return yield parseWordText(fileBuffer);
    }
    return { fullText: '', email: null, inferredName: null, skills: [], parser: 'unsupported' };
});
exports.parseResumeBuffer = parseResumeBuffer;
