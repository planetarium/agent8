import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { getTemplates } from '~/utils/selectStarterTemplate';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.select-template');

/*
 * In-memory cache for templates
 * Key format: `${templateName}:${title || ''}`
 */
const templateCache: Record<
  string,
  {
    data: any;
    files: any;
    timestamp: number;
    expiresAt: number;
  }
> = {};

// Cache expiration time (24 hours in milliseconds)
const CACHE_TTL = 24 * 60 * 60 * 1000;

export const loader = withV8AuthUser(selectTemplateAction, { checkCredit: true });

export async function selectTemplateAction({ request, context }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const url = new URL(request.url);
  const templateName = url.searchParams.get('templateName');
  const title = url.searchParams.get('title') || '';
  const repo = url.searchParams.get('repo');
  const path = url.searchParams.get('path');

  if (!templateName || !repo || !path) {
    return json({ error: 'templateName, repo, and path are required' }, { status: 400 });
  }

  try {
    const cacheKey = `${templateName}`;
    const now = Date.now();

    // Check if we have a valid cached response
    if (!templateCache[cacheKey] || templateCache[cacheKey].expiresAt < now) {
      // Cache miss or expired, fetch from GitHub
      logger.info(`Cache miss for template: ${cacheKey}, fetching from GitHub`);

      const { fileMap, messages } = await getTemplates(repo, path, title, env);

      const files = [];

      for (const key in fileMap) {
        if (fileMap[key]!.type === 'file') {
          files.push({
            path: key,
            content: fileMap[key]!.content,
          });
        }
      }

      // Store in cache
      templateCache[cacheKey] = {
        data: messages,
        files,
        timestamp: now,
        expiresAt: now + CACHE_TTL,
      };
    }

    return json({
      data: templateCache[cacheKey].data,
      cachedAt: new Date(templateCache[cacheKey].timestamp).toISOString(),
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    return json({ error: 'Failed to fetch template', details: (error as Error).message }, { status: 500 });
  }
}

// Optional: Add a function to clear the cache or specific entries
export async function action({ request }: ActionFunctionArgs) {
  // Only allow POST requests for cache management
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { action, templateName, title } = body as {
      action: string;
      templateName: string;
      title: string;
    };

    if (action === 'clearCache') {
      if (templateName) {
        // Clear specific template cache
        const cacheKey = `${templateName}:${title || ''}`;

        if (templateCache[cacheKey]) {
          delete templateCache[cacheKey];
          return json({ success: true, message: `Cache cleared for ${cacheKey}` });
        }

        return json({ success: false, message: 'Cache entry not found' });
      } else {
        // Clear all cache
        Object.keys(templateCache).forEach((key) => delete templateCache[key]);
        return json({ success: true, message: 'All cache cleared' });
      }
    }

    return json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error processing cache action:', error);
    return json({ error: 'Failed to process request' }, { status: 500 });
  }
}
