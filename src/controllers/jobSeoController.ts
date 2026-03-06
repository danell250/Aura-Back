import { Request, Response } from 'express';
import { parsePositiveInt } from '../utils/inputSanitizers';
import {
  createJobsSitemapReadStream,
  getJobsSitemapFallbackXml,
  readJobsSitemapFilePath,
  refreshJobsSitemapCache,
} from '../services/jobSeoSitemapService';

const SITEMAP_MAX_URLS = 50_000;

export const jobSeoController = {
  // GET /api/jobs/sitemap.xml
  getJobsSitemap: async (req: Request, res: Response) => {
    try {
      const limit = parsePositiveInt((req.query as any)?.limit, SITEMAP_MAX_URLS, 1, SITEMAP_MAX_URLS);
      const filePath = await readJobsSitemapFilePath(limit);
      void refreshJobsSitemapCache(limit).catch((error) => {
        console.error('Refresh jobs sitemap cache error:', error);
      });

      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=1800');

      if (!filePath) {
        res.status(200).send(getJobsSitemapFallbackXml());
        return;
      }

      const stream = createJobsSitemapReadStream(filePath);
      stream.on('error', (error) => {
        console.error('Read jobs sitemap cache error:', error);
        if (!res.headersSent) {
          res.status(200).send(getJobsSitemapFallbackXml());
        } else if (!res.writableEnded) {
          res.end();
        }
      });
      stream.pipe(res);
      return;
    } catch (error) {
      console.error('Get jobs sitemap error:', error);
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.status(200).send(getJobsSitemapFallbackXml());
      return;
    }
  },
};
