import { createReadStream, createWriteStream, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { once } from 'events';
import type { Db } from 'mongodb';
import { getDB, isDBConnected } from '../db';
import { readString } from '../utils/inputSanitizers';
import { toJobResponse } from './jobResponseService';

const JOBS_COLLECTION = 'jobs';
const DEFAULT_SITEMAP_MAX_URLS = 50_000;
const SITEMAP_CACHE_TTL_MS = 60 * 60 * 1000;
const SITEMAP_CACHE_MAX_KEYS = 4;
const SITEMAP_CACHE_DIR = path.join(os.tmpdir(), 'aura-jobs-sitemaps');
const AURA_PUBLIC_WEB_BASE_URL = (
  readString(process.env.AURA_PUBLIC_WEB_URL, 320)
  || readString(process.env.FRONTEND_URL, 320)
  || readString(process.env.VITE_FRONTEND_URL, 320)
  || 'https://aura.social'
).replace(/\/+$/, '');

type SitemapCacheEntry = {
  expiresAt: number;
  filePath: string;
};

const sitemapCache = new Map<number, SitemapCacheEntry>();
const pendingSitemapBuilds = new Map<number, Promise<string>>();
let jobsSitemapIndexesPromise: Promise<void> | null = null;

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const normalizeSitemapLimit = (limit = DEFAULT_SITEMAP_MAX_URLS): number =>
  Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), DEFAULT_SITEMAP_MAX_URLS) : DEFAULT_SITEMAP_MAX_URLS;

const buildSitemapUrlEntry = (params: {
  loc: string;
  lastmod?: string | null;
  priority: string;
  changefreq: string;
}): string => [
  '<url>',
  `<loc>${escapeXml(params.loc)}</loc>`,
  params.lastmod ? `<lastmod>${escapeXml(params.lastmod)}</lastmod>` : '',
  `<changefreq>${params.changefreq}</changefreq>`,
  `<priority>${params.priority}</priority>`,
  '</url>',
].join('');

const removeFile = async (filePath: string | null | undefined): Promise<void> => {
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => undefined);
};

const trimSitemapCache = async (): Promise<void> => {
  while (sitemapCache.size > SITEMAP_CACHE_MAX_KEYS) {
    const oldest = sitemapCache.keys().next();
    if (oldest.done) break;
    const entry = sitemapCache.get(oldest.value);
    sitemapCache.delete(oldest.value);
    await removeFile(entry?.filePath);
  }
};

const readCachedSitemapPath = async (limit: number, allowStale = false): Promise<string | null> => {
  const cached = sitemapCache.get(limit);
  if (!cached) return null;
  if (!allowStale && cached.expiresAt <= Date.now()) {
    sitemapCache.delete(limit);
    await removeFile(cached.filePath);
    return null;
  }

  const exists = await fs.access(cached.filePath).then(() => true).catch(() => false);
  if (!exists) {
    sitemapCache.delete(limit);
    return null;
  }

  sitemapCache.delete(limit);
  sitemapCache.set(limit, cached);
  return cached.filePath;
};

const storeCachedSitemap = async (limit: number, filePath: string): Promise<string> => {
  const existing = sitemapCache.get(limit);
  sitemapCache.set(limit, {
    expiresAt: Date.now() + SITEMAP_CACHE_TTL_MS,
    filePath,
  });
  if (existing && existing.filePath !== filePath) {
    await removeFile(existing.filePath);
  }
  await trimSitemapCache();
  return filePath;
};

const buildJobsBoardSitemapEntry = (): string => buildSitemapUrlEntry({
  loc: `${AURA_PUBLIC_WEB_BASE_URL}/jobs`,
  lastmod: new Date().toISOString(),
  changefreq: 'hourly',
  priority: '0.9',
});

export const ensureJobSeoSitemapIndexes = async (db: Db): Promise<void> => {
  if (!jobsSitemapIndexesPromise) {
    jobsSitemapIndexesPromise = (async () => {
      await db.collection(JOBS_COLLECTION).createIndex(
        {
          status: 1,
          updatedAt: -1,
          publishedAt: -1,
          createdAt: -1,
          slug: 1,
          title: 1,
          locationText: 1,
          companyName: 1,
          companyHandle: 1,
          id: 1,
        },
        { name: 'jobs_sitemap_status_updated_published_created_idx' },
      );
    })().catch((error) => {
      jobsSitemapIndexesPromise = null;
      throw error;
    });
  }
  return jobsSitemapIndexesPromise;
};

export const getJobsSitemapFallbackXml = (): string => [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  buildJobsBoardSitemapEntry(),
  '</urlset>',
].join('');

const writeXmlChunk = async (stream: NodeJS.WritableStream, chunk: string): Promise<void> => {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
};

const buildJobsSitemapFile = async (limit: number): Promise<string> => {
  await fs.mkdir(SITEMAP_CACHE_DIR, { recursive: true });
  const finalPath = path.join(SITEMAP_CACHE_DIR, `jobs-sitemap-${limit}.xml`);
  const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  const stream = createWriteStream(tempPath, { encoding: 'utf8' });

  try {
    await writeXmlChunk(stream, '<?xml version="1.0" encoding="UTF-8"?>');
    await writeXmlChunk(stream, '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    await writeXmlChunk(stream, buildJobsBoardSitemapEntry());

    if (isDBConnected()) {
      const db = getDB();
      await ensureJobSeoSitemapIndexes(db);
      const cursor = db.collection(JOBS_COLLECTION)
        .find(
          { status: 'open' },
          {
            projection: {
              id: 1,
              slug: 1,
              title: 1,
              locationText: 1,
              companyName: 1,
              companyHandle: 1,
              updatedAt: 1,
              publishedAt: 1,
              createdAt: 1,
            },
          },
        )
        .sort({ updatedAt: -1, publishedAt: -1, createdAt: -1 })
        .limit(limit);

      try {
        for await (const job of cursor) {
          const response = toJobResponse(job);
          const slug = readString(response.slug, 220);
          if (!slug) continue;
          const sitemapLastModified =
            readString(job?.updatedAt, 80)
            || readString(job?.publishedAt, 80)
            || readString(job?.createdAt, 80)
            || null;

          await writeXmlChunk(stream, buildSitemapUrlEntry({
            loc: `${AURA_PUBLIC_WEB_BASE_URL}/jobs/${encodeURIComponent(slug)}`,
            lastmod: sitemapLastModified,
            changefreq: 'hourly',
            priority: '0.8',
          }));
        }
      } finally {
        await cursor.close().catch(() => undefined);
      }
    }

    await writeXmlChunk(stream, '</urlset>');
    stream.end();
    await once(stream, 'finish');
    await fs.rename(tempPath, finalPath);
    return finalPath;
  } catch (error) {
    stream.destroy();
    await removeFile(tempPath);
    throw error;
  }
};

export const invalidateJobsSitemapCache = async (): Promise<void> => {
  const filePaths = Array.from(sitemapCache.values()).map((entry) => entry.filePath);
  sitemapCache.clear();
  pendingSitemapBuilds.clear();
  await Promise.all(filePaths.map((filePath) => removeFile(filePath)));
};

export const readJobsSitemapFilePath = async (limit = DEFAULT_SITEMAP_MAX_URLS): Promise<string | null> =>
  readCachedSitemapPath(normalizeSitemapLimit(limit), true);

export const refreshJobsSitemapCache = async (limit = DEFAULT_SITEMAP_MAX_URLS): Promise<string> => {
  const normalizedLimit = normalizeSitemapLimit(limit);
  const freshCached = await readCachedSitemapPath(normalizedLimit);
  if (freshCached) return freshCached;
  const existingBuild = pendingSitemapBuilds.get(normalizedLimit);
  if (existingBuild) return existingBuild;

  const nextBuild = buildJobsSitemapFile(normalizedLimit)
    .then((filePath) => storeCachedSitemap(normalizedLimit, filePath))
    .finally(() => {
      pendingSitemapBuilds.delete(normalizedLimit);
    });

  pendingSitemapBuilds.set(normalizedLimit, nextBuild);
  return nextBuild;
};

export const createJobsSitemapReadStream = (filePath: string) => createReadStream(filePath, { encoding: 'utf8' });
