import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { STARTER_TEMPLATES } from '~/utils/constants';
import { getTemplates } from '~/utils/selectStarterTemplate';

/*
 * In-memory cache for templates
 * Key format: `${templateName}:${title || ''}`
 */
const templateCache: Record<
  string,
  {
    data: any;
    timestamp: number;
    expiresAt: number;
  }
> = {};

// Cache expiration time (24 hours in milliseconds)
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function loader({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const templateName = url.searchParams.get('templateName');
  const title = url.searchParams.get('title') || undefined;

  if (!templateName) {
    return json({ error: 'templateName is required' }, { status: 400 });
  }

  try {
    // Create a cache key based on templateName and title
    const cacheKey = `${templateName}:${title || ''}`;
    const now = Date.now();

    // Check if we have a valid cached response
    if (templateCache[cacheKey] && templateCache[cacheKey].expiresAt > now) {
      console.log(`Cache hit for template: ${cacheKey}`);
      return json({
        data: templateCache[cacheKey].data,
        cached: true,
        cachedAt: new Date(templateCache[cacheKey].timestamp).toISOString(),
      });
    }

    // Cache miss or expired, fetch from GitHub
    console.log(`Cache miss for template: ${cacheKey}, fetching from GitHub`);

    const template = STARTER_TEMPLATES.find((t) => t.name == templateName);

    if (!template) {
      return json({ error: 'Template not found' }, { status: 404 });
    }

    const templateData = await getTemplates(template.githubRepo, template.path, title);

    // Store in cache
    templateCache[cacheKey] = {
      data: templateData,
      timestamp: now,
      expiresAt: now + CACHE_TTL,
    };

    return json({
      data: templateData,
      cached: false,
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
    const { action, templateName, title } = body as { action: string; templateName: string; title: string };

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
