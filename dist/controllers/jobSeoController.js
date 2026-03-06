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
exports.jobSeoController = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobSeoSitemapService_1 = require("../services/jobSeoSitemapService");
const SITEMAP_MAX_URLS = 50000;
exports.jobSeoController = {
    // GET /api/jobs/sitemap.xml
    getJobsSitemap: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const limit = (0, inputSanitizers_1.parsePositiveInt)((_a = req.query) === null || _a === void 0 ? void 0 : _a.limit, SITEMAP_MAX_URLS, 1, SITEMAP_MAX_URLS);
            const filePath = yield (0, jobSeoSitemapService_1.readJobsSitemapFilePath)(limit);
            void (0, jobSeoSitemapService_1.refreshJobsSitemapCache)(limit).catch((error) => {
                console.error('Refresh jobs sitemap cache error:', error);
            });
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=1800');
            if (!filePath) {
                res.status(200).send((0, jobSeoSitemapService_1.getJobsSitemapFallbackXml)());
                return;
            }
            const stream = (0, jobSeoSitemapService_1.createJobsSitemapReadStream)(filePath);
            stream.on('error', (error) => {
                console.error('Read jobs sitemap cache error:', error);
                if (!res.headersSent) {
                    res.status(200).send((0, jobSeoSitemapService_1.getJobsSitemapFallbackXml)());
                }
                else if (!res.writableEnded) {
                    res.end();
                }
            });
            stream.pipe(res);
            return;
        }
        catch (error) {
            console.error('Get jobs sitemap error:', error);
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.status(200).send((0, jobSeoSitemapService_1.getJobsSitemapFallbackXml)());
            return;
        }
    }),
};
