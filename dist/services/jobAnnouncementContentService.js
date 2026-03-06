"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobAnnouncementContent = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const toAnnouncementTag = (tag) => tag.replace(/[^a-z0-9]/gi, '').toLowerCase();
const normalizeAnnouncementText = (value, maxLength, fallback = '') => (0, inputSanitizers_1.readString)(value, maxLength) || fallback;
const normalizeAnnouncementEnumText = (value, maxLength, fallback) => {
    const normalized = normalizeAnnouncementText(value, maxLength)
        .replace(/_/g, ' ')
        .trim();
    return normalized || fallback;
};
const buildJobAnnouncementContent = (job) => {
    const title = normalizeAnnouncementText(job.title, 160, 'New role');
    const companyName = normalizeAnnouncementText(job.companyName, 160, 'Company');
    const locationText = normalizeAnnouncementText(job.locationText, 160, 'Flexible location');
    const workModel = normalizeAnnouncementEnumText(job.workModel, 60, 'flexible');
    const employmentType = normalizeAnnouncementEnumText(job.employmentType, 60, 'role');
    const summary = normalizeAnnouncementText(job.summary, 6000);
    const normalizedTags = Array.from(new Set((Array.isArray(job.tags) ? job.tags : [])
        .map(toAnnouncementTag)
        .filter((value) => value.length > 0))).slice(0, 5);
    const hashtagList = Array.from(new Set(['hiring', 'jobs', ...normalizedTags]))
        .map((tag) => `#${tag}`)
        .join(' ');
    return [
        `We're hiring: ${title}`,
        '',
        `${companyName} is opening a new role.`,
        `Location: ${locationText} • ${workModel} • ${employmentType}`,
        '',
        summary,
        '',
        'Apply directly from our Jobs tab on Aura.',
        hashtagList,
    ].join('\n');
};
exports.buildJobAnnouncementContent = buildJobAnnouncementContent;
