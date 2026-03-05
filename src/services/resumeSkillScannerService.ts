import { RESUME_SKILLS_DICTIONARY } from '../config/resumeSkills';

const MAX_SKILL_SCAN_TEXT_LENGTH = 60000;
const MAX_EXTRACTED_SKILLS = 80;
const SKILL_SCAN_YIELD_EVERY = 25;

type SkillTrieNode = {
  children: Map<string, SkillTrieNode>;
  terminalSkill: string | null;
};

type SkillScanState = {
  dedupe: Set<string>;
  foundSkills: string[];
};

const normalizeSkillToken = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+.#\-/\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const buildSkillLookup = () => {
  const normalizedToDisplay = new Map<string, string>();
  for (const skill of RESUME_SKILLS_DICTIONARY) {
    const normalized = normalizeSkillToken(skill);
    if (!normalized || normalizedToDisplay.has(normalized)) continue;
    normalizedToDisplay.set(normalized, skill);
  }
  return normalizedToDisplay;
};

const createSkillTrieNode = (): SkillTrieNode => ({
  children: new Map<string, SkillTrieNode>(),
  terminalSkill: null,
});

const buildSkillTrie = (skillLookup: Map<string, string>): SkillTrieNode => {
  const root = createSkillTrieNode();
  for (const [normalizedPhrase, displaySkill] of skillLookup.entries()) {
    const tokens = normalizedPhrase.split(' ').filter(Boolean);
    if (tokens.length === 0) continue;

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

const yieldToEventLoop = async (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const tokenizeForSkillScan = (text: string): string[] => {
  const normalizedText = normalizeSkillToken(text).slice(0, MAX_SKILL_SCAN_TEXT_LENGTH);
  if (!normalizedText) return [];
  return normalizedText.split(' ').filter(Boolean);
};

const scanTrieFromToken = (tokens: string[], startIndex: number, state: SkillScanState): boolean => {
  let node = SKILL_TRIE_ROOT;
  for (let cursor = startIndex; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    const nextNode = node.children.get(token);
    if (!nextNode) break;

    node = nextNode;
    if (!node.terminalSkill) continue;
    if (state.dedupe.has(node.terminalSkill)) continue;

    state.dedupe.add(node.terminalSkill);
    state.foundSkills.push(node.terminalSkill);
    if (state.foundSkills.length >= MAX_EXTRACTED_SKILLS) {
      return true;
    }
  }
  return false;
};

const extractSkillsWithYielding = async (tokens: string[]): Promise<string[]> => {
  const state: SkillScanState = {
    dedupe: new Set<string>(),
    foundSkills: [],
  };

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const reachedLimit = scanTrieFromToken(tokens, tokenIndex, state);
    if (reachedLimit) {
      return state.foundSkills;
    }
    if ((tokenIndex + 1) % SKILL_SCAN_YIELD_EVERY === 0) {
      await yieldToEventLoop();
    }
  }

  return state.foundSkills;
};

export const extractResumeSkills = async (text: string): Promise<string[]> => {
  const tokens = tokenizeForSkillScan(text);
  if (tokens.length === 0) return [];
  return await extractSkillsWithYielding(tokens);
};
