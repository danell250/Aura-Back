import { extractResumeEmail, inferResumeName } from './resumeEntityExtractionService';
import { extractResumeSkills } from './resumeSkillScannerService';

export const RESUME_SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const MAX_RESUME_TEXT_LENGTH = 200000;

export type ResumeParseResult = {
  fullText: string;
  email: string | null;
  inferredName: string | null;
  skills: string[];
  parser: 'pdf-parse' | 'mammoth' | 'plaintext' | 'unsupported' | 'none';
};

type PdfParseFn = (buffer: Buffer) => Promise<{ text?: string }>;
type MammothModule = {
  extractRawText: (params: { buffer: Buffer }) => Promise<{ value?: string }>;
};

const readString = (value: unknown, maxLength = 10000): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized.slice(0, maxLength);
};

const isPdfParseFn = (candidate: unknown): candidate is PdfParseFn =>
  typeof candidate === 'function';

const resolvePdfParseFn = (pdfParseModule: any): PdfParseFn | null => {
  const visited = new Set<any>();
  const queue: unknown[] = [
    pdfParseModule,
    pdfParseModule?.default,
    pdfParseModule?.pdfParse,
    pdfParseModule?.parse,
  ];

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (isPdfParseFn(candidate)) return candidate;
    if (!candidate || typeof candidate !== 'object') continue;
    if (visited.has(candidate)) continue;
    visited.add(candidate);

    const moduleLike = candidate as Record<string, unknown>;
    queue.push(moduleLike.default, moduleLike.pdfParse, moduleLike.parse);
  }

  return null;
};

const loadPdfParserFromRequire = (): PdfParseFn | null => {
  try {
    // Optional runtime dependency: if unavailable, parsing gracefully falls back.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParseModule = require('pdf-parse');
    return resolvePdfParseFn(pdfParseModule);
  } catch {
    return null;
  }
};

const resolveMammothModule = (candidate: any): MammothModule | null => {
  const moduleLike = candidate?.default || candidate;
  if (moduleLike && typeof moduleLike.extractRawText === 'function') {
    return moduleLike as MammothModule;
  }
  return null;
};

const loadMammoth = (): MammothModule | null => {
  try {
    // Optional runtime dependency for DOCX text extraction.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammothModule = require('mammoth');
    return resolveMammothModule(mammothModule);
  } catch {
    return null;
  }
};

const toResumeParseResult = async (
  fullText: string,
  parser: ResumeParseResult['parser'],
): Promise<ResumeParseResult> => {
  return {
    fullText,
    email: extractResumeEmail(fullText),
    inferredName: inferResumeName(fullText),
    skills: await extractResumeSkills(fullText),
    parser,
  };
};

const parsePdfText = async (fileBuffer: Buffer): Promise<ResumeParseResult> => {
  const pdfParse = loadPdfParserFromRequire();
  if (!pdfParse) {
    return { fullText: '', email: null, inferredName: null, skills: [], parser: 'none' };
  }

  try {
    const parsed = await pdfParse(fileBuffer);
    const fullText = readString(parsed?.text || '', MAX_RESUME_TEXT_LENGTH);
    return await toResumeParseResult(fullText, 'pdf-parse');
  } catch (error) {
    console.warn('Resume parsing: pdf parse failed', error);
    return { fullText: '', email: null, inferredName: null, skills: [], parser: 'none' };
  }
};

const parseWordText = async (fileBuffer: Buffer): Promise<ResumeParseResult> => {
  const mammoth = loadMammoth();
  if (!mammoth) {
    return { fullText: '', email: null, inferredName: null, skills: [], parser: 'none' };
  }

  try {
    const parsed = await mammoth.extractRawText({ buffer: fileBuffer });
    const fullText = readString(parsed?.value || '', MAX_RESUME_TEXT_LENGTH);
    return await toResumeParseResult(fullText, 'mammoth');
  } catch (error) {
    console.warn('Resume parsing: word parse failed', error);
    return { fullText: '', email: null, inferredName: null, skills: [], parser: 'none' };
  }
};

const parseTextContent = async (fileBuffer: Buffer): Promise<ResumeParseResult> => {
  const fullText = readString(fileBuffer.toString('utf-8'), MAX_RESUME_TEXT_LENGTH);
  return await toResumeParseResult(fullText, 'plaintext');
};

export const parseResumeBuffer = async (
  fileBuffer: Buffer,
  mimeType: string,
): Promise<ResumeParseResult> => {
  const normalizedMime = readString(mimeType, 120).toLowerCase();
  if (!fileBuffer || fileBuffer.length === 0) {
    return { fullText: '', email: null, inferredName: null, skills: [], parser: 'none' };
  }

  if (normalizedMime === 'text/plain') {
    return await parseTextContent(fileBuffer);
  }

  if (normalizedMime === 'application/pdf') {
    return await parsePdfText(fileBuffer);
  }

  if (
    normalizedMime === 'application/msword' ||
    normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return await parseWordText(fileBuffer);
  }

  return { fullText: '', email: null, inferredName: null, skills: [], parser: 'unsupported' };
};
