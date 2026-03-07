"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAggregatedJobDerivedFields = void 0;
const jobRecommendationService_1 = require("./jobRecommendationService");
const openToWorkDemandService_1 = require("./openToWorkDemandService");
const buildAggregatedJobDerivedFields = (params) => (Object.assign(Object.assign(Object.assign({}, (0, jobRecommendationService_1.buildJobRecommendationPrecomputedFields)({
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
})), ((0, openToWorkDemandService_1.buildDemandRoleFields)(params.title) || {})), (0, openToWorkDemandService_1.buildJobMarketDemandPrecomputedFields)({
    createdAt: params.createdAt,
    publishedAt: params.publishedAt,
    salaryMin: params.salaryMin,
    salaryMax: params.salaryMax,
})));
exports.buildAggregatedJobDerivedFields = buildAggregatedJobDerivedFields;
