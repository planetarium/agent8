import { VIBE_STARTER_3D_PACKAGE_NAME, WORK_DIR } from '~/utils/constants';
import semver from 'semver';
import type { Cache } from '@cloudflare/workers-types';

const CACHE_HEADERS = {
  CACHE_CONTROL: 'Cache-Control',
  VARY: 'Vary',
  SET_COOKIE: 'Set-Cookie',
} as const;

const CACHE_DIRECTIVES = {
  PUBLIC: 'public',
  PRIVATE: 'private',
  S_MAXAGE: 's-maxage',
  MAX_AGE: 'max-age',
} as const;

interface CloudflareCacheStorage extends CacheStorage {
  default: Cache;
}

export interface FetchWithCacheOptions {
  /** Cache namespace (default: caches.default) */
  cacheNamespace?: Cache;

  /** Cache TTL in seconds (default: 86400 = 24 hours) */
  cacheTTL?: number;

  /**
   * Use only URL for cache key, ignoring headers
   * Useful for APIs with Authorization header but same content for all users
   */
  onlyUrl?: boolean;

  /** Force Cache-Control to 'public' even if response says 'private' */
  forcePublic?: boolean;

  /** Remove Vary header to prevent cache fragmentation */
  ignoreVary?: boolean;

  /** Completely override Cache-Control header */
  overrideCacheControl?: string;
}

function getPackageContent(files: any): string {
  const packageFile = files[`${WORK_DIR}/package.json`];

  return packageFile?.type === 'file' ? packageFile.content : '';
}

export async function resolvePackageVersion(packageName: string, files: any): Promise<string> {
  try {
    const packageContent = getPackageContent(files);
    const packageJson = JSON.parse(packageContent);
    const version = packageJson.dependencies?.[packageName];

    if (version) {
      return await getActualVersion(packageName, version);
    }

    return await getLatestVersion(packageName);
  } catch {
    throw new Error(`Failed to get version from package ${packageName}`);
  }
}

async function getActualVersion(packageName: string, versionRange: string): Promise<string> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}`);
    const packageInfo = (await res.json()) as { versions: Record<string, any> };
    const versions = Object.keys(packageInfo.versions);

    const actualVersion = semver.maxSatisfying(versions, versionRange);

    return actualVersion || versionRange;
  } catch {
    throw new Error(`Failed to resolve version for ${packageName}@${versionRange}`);
  }
}

async function getLatestVersion(packageName: string): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${packageName}`);

  if (!res.ok) {
    throw new Error(`Failed to fetch package metadata: ${res.status}`);
  }

  const metadata: any = await res.json();
  const latestVersion = metadata['dist-tags']?.latest;

  if (!latestVersion) {
    throw new Error('Latest version not found');
  }

  return latestVersion;
}

export async function fetchWithCache(request: Request, options: FetchWithCacheOptions = {}): Promise<Response> {
  const {
    cacheNamespace,
    cacheTTL = 86400,
    onlyUrl = false,
    forcePublic = false,
    ignoreVary = false,
    overrideCacheControl,
  } = options;

  const isExistCaches = typeof caches !== 'undefined';
  const cache = cacheNamespace ?? (isExistCaches ? (caches as CloudflareCacheStorage).default : undefined);

  try {
    let response: Response;

    if (cache) {
      let cacheKey: Request;

      if (onlyUrl) {
        cacheKey = new Request(request.url, { method: request.method || 'GET' });
      } else {
        const cacheUrl = new URL(request.url);
        cacheKey = new Request(cacheUrl.toString(), request);
      }

      response = (await cache.match(cacheKey as any)) as unknown as Response;

      if (!response) {
        response = await fetch(request);

        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        }

        const originalCacheControl = response.headers.get(CACHE_HEADERS.CACHE_CONTROL);

        const responseBody = await response.arrayBuffer();
        response = new Response(responseBody, response);

        if (overrideCacheControl) {
          response.headers.set(CACHE_HEADERS.CACHE_CONTROL, overrideCacheControl);
        } else if (forcePublic) {
          let newCacheControl = originalCacheControl || CACHE_DIRECTIVES.PUBLIC;

          // 1. private → public update
          const privatePattern = new RegExp(`\\b${CACHE_DIRECTIVES.PRIVATE}\\b`);
          newCacheControl = newCacheControl.replace(privatePattern, CACHE_DIRECTIVES.PUBLIC);

          // 2. s-maxage update or add
          const sMaxAgePattern = new RegExp(`${CACHE_DIRECTIVES.S_MAXAGE}=\\d+`);

          if (sMaxAgePattern.test(newCacheControl)) {
            newCacheControl = newCacheControl.replace(sMaxAgePattern, `${CACHE_DIRECTIVES.S_MAXAGE}=${cacheTTL}`);
          } else {
            newCacheControl += `, ${CACHE_DIRECTIVES.S_MAXAGE}=${cacheTTL}`;
          }

          // 3. max-age update or add
          const maxAgePattern = new RegExp(`\\b${CACHE_DIRECTIVES.MAX_AGE}=\\d+`);

          if (maxAgePattern.test(newCacheControl)) {
            newCacheControl = newCacheControl.replace(maxAgePattern, `${CACHE_DIRECTIVES.MAX_AGE}=${cacheTTL}`);
          } else {
            newCacheControl += `, ${CACHE_DIRECTIVES.MAX_AGE}=${cacheTTL}`;
          }

          // 4. clean up
          newCacheControl = newCacheControl.replace(/,\s*,/g, ',').trim();

          response.headers.set(CACHE_HEADERS.CACHE_CONTROL, newCacheControl);
        } else {
          response.headers.append(CACHE_HEADERS.CACHE_CONTROL, `${CACHE_DIRECTIVES.S_MAXAGE}=${cacheTTL}`);
        }

        if (ignoreVary) {
          response.headers.delete(CACHE_HEADERS.VARY);
        }

        try {
          await cache.put(cacheKey as any, response.clone() as any);
        } catch (e) {
          console.error('[Cache] Failed to cache:', e);
        }
      }
    } else {
      response = await fetch(request);

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }
    }

    return response;
  } catch (error) {
    throw new Error(`Failed to fetch from ${request.url}: ${error}`);
  }
}

export function extractMarkdownFileNamesFromUnpkgHtml(html: string): string[] {
  const linkRegex = /<a[^>]*href="[^"]*\.md"[^>]*>([^<]*\.md)<\/a>/gi;
  const fileNames: string[] = [];

  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const fileName = match[1].trim();

    if (fileName && fileName.endsWith('.md')) {
      fileNames.push(fileName);
    }
  }

  return fileNames;
}

export function is3dProject(files: any): boolean {
  if (!files || Object.keys(files).length === 0) {
    return false;
  }

  const packageJson = files[`${WORK_DIR}/package.json`];

  if (packageJson?.type === 'file' && packageJson?.content?.length > 0) {
    const packageContent = JSON.parse(packageJson.content);

    if (packageContent.dependencies?.hasOwnProperty(VIBE_STARTER_3D_PACKAGE_NAME)) {
      return true;
    }
  }

  return false;
}
