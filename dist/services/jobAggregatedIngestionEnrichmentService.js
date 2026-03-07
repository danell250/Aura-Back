"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAggregatedJobDerivedFields = void 0;
const jobRecommendationService_1 = require("./jobRecommendationService");
const jobAlertCategoryService_1 = require("./jobAlertCategoryService");
const openToWorkDemandService_1 = require("./openToWorkDemandService");
const buildAggregatedJobDerivedFields = (params) => {
    const demandRoleFields = (0, openToWorkDemandService_1.buildDemandRoleFields)(params.title) || {};
    const categoryFields = (0, jobAlertCategoryService_1.buildJobAlertCategoryFields)({
        title: params.title,
        summary: params.summary,
        description: params.description,
        tags: params.tags,
        demandRoleFamily: demandRoleFields === null || demandRoleFields === void 0 ? void 0 : demandRoleFields.demandRoleFamily,
    });
    return Object.assign(Object.assign(Object.assign(Object.assign({}, (0, jobRecommendationService_1.buildJobRecommendationPrecomputedFields)({
        title: params.title,
        summary: params.summary,
        description: params.description,
        locationText: params.locationText,
        tags: params.tags,
        workModel: params.workModel,
        salaryMin: params.salaryMin,
        salaryMax: params.salaryMax,
        createdAt: params.createdAt,
        publishedAt: params.publishedAt,
    })), demandRoleFields), categoryFields), (0, openToWorkDemandService_1.buildJobMarketDemandPrecomputedFields)({
        createdAt: params.createdAt,
        publishedAt: params.publishedAt,
        salaryMin: params.salaryMin,
        salaryMax: params.salaryMax,
    }));
};
exports.buildAggregatedJobDerivedFields = buildAggregatedJobDerivedFields;
