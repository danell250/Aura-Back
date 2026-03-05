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
exports.extractResumeSkills = void 0;
const resumeSkills_1 = require("../config/resumeSkills");
const MAX_SKILL_SCAN_TEXT_LENGTH = 60000;
const MAX_EXTRACTED_SKILLS = 80;
const SKILL_SCAN_YIELD_EVERY = 25;
const normalizeSkillToken = (value) => value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+.#\-/\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const buildSkillLookup = () => {
    const normalizedToDisplay = new Map();
    for (const skill of resumeSkills_1.RESUME_SKILLS_DICTIONARY) {
        const normalized = normalizeSkillToken(skill);
        if (!normalized || normalizedToDisplay.has(normalized))
            continue;
        normalizedToDisplay.set(normalized, skill);
    }
    return normalizedToDisplay;
};
const createSkillTrieNode = () => ({
    children: new Map(),
    terminalSkill: null,
});
const buildSkillTrie = (skillLookup) => {
    const root = createSkillTrieNode();
    for (const [normalizedPhrase, displaySkill] of skillLookup.entries()) {
        const tokens = normalizedPhrase.split(' ').filter(Boolean);
        if (tokens.length === 0)
            continue;
        let cursor = root;
        for (const token of tokens) {
            const nextNode = cursor.children.get(token) || createSkillTrieNode();
            cursor.children.set(token, nextNode);
            cursor = nextNode;
        }
        cursor.terminalSkill = displaySkill;
    }
    return root;
};
const SKILL_LOOKUP = buildSkillLookup();
const SKILL_TRIE_ROOT = buildSkillTrie(SKILL_LOOKUP);
const yieldToEventLoop = () => __awaiter(void 0, void 0, void 0, function* () { return new Promise((resolve) => setImmediate(resolve)); });
const tokenizeForSkillScan = (text) => {
    const normalizedText = normalizeSkillToken(text).slice(0, MAX_SKILL_SCAN_TEXT_LENGTH);
    if (!normalizedText)
        return [];
    return normalizedText.split(' ').filter(Boolean);
};
const scanTrieFromToken = (tokens, startIndex, state) => {
    let node = SKILL_TRIE_ROOT;
    for (let cursor = startIndex; cursor < tokens.length; cursor += 1) {
        const token = tokens[cursor];
        const nextNode = node.children.get(token);
        if (!nextNode)
            break;
        node = nextNode;
        if (!node.terminalSkill)
            continue;
        if (state.dedupe.has(node.terminalSkill))
            continue;
        state.dedupe.add(node.terminalSkill);
        state.foundSkills.push(node.terminalSkill);
        if (state.foundSkills.length >= MAX_EXTRACTED_SKILLS) {
            return true;
        }
    }
    return false;
};
const extractSkillsWithYielding = (tokens) => __awaiter(void 0, void 0, void 0, function* () {
    const state = {
        dedupe: new Set(),
        foundSkills: [],
    };
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
        const reachedLimit = scanTrieFromToken(tokens, tokenIndex, state);
        if (reachedLimit) {
            return state.foundSkills;
        }
        if ((tokenIndex + 1) % SKILL_SCAN_YIELD_EVERY === 0) {
            yield yieldToEventLoop();
        }
    }
    return state.foundSkills;
});
const extractResumeSkills = (text) => __awaiter(void 0, void 0, void 0, function* () {
    const tokens = tokenizeForSkillScan(text);
    if (tokens.length === 0)
        return [];
    return yield extractSkillsWithYielding(tokens);
});
exports.extractResumeSkills = extractResumeSkills;
