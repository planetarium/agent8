import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { getTemplates } from '~/utils/selectStarterTemplate';
import { createRepository, commitFilesToRepo } from '~/lib/repoManager/api';
import { withV8AuthUser } from '~/lib/verse8/middleware';

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
  const title = url.searchParams.get('title') || undefined;
  const repo = url.searchParams.get('repo');
  const path = url.searchParams.get('path');
  const projectRepo = url.searchParams.get('projectRepo');
  const projectSummary = url.searchParams.get('projectSummary');
  const user = context?.user as { email: string; accessToken: string };
  const email = user?.email || '';
  const userAccessToken = user?.accessToken || '';

  if (!templateName || !repo || !path) {
    return json({ error: 'templateName, repo, and path are required' }, { status: 400 });
  }

  try {
    // Create a cache key based on templateName and title
    const cacheKey = `${templateName}:${title || ''}`;
    const now = Date.now();

    // Check if we have a valid cached response
    if (templateCache[cacheKey] && templateCache[cacheKey].expiresAt > now) {
      console.log(`Cache hit for template: ${cacheKey}`);

      const repository = await createRepository(
        env,
        userAccessToken,
        email,
        projectRepo || `template-${templateName}-${Date.now()}`,
        projectSummary || '',
      );

      // If registerToRepo is true, commit the cached template to the repository
      if (templateCache[cacheKey].files) {
        await commitFilesToRepo(
          env,
          userAccessToken,
          email,
          repository.name,
          templateCache[cacheKey].files,
          'Initial Commit',
        );

        return json({
          data: templateCache[cacheKey].data,
          cached: true,
          cachedAt: new Date(templateCache[cacheKey].timestamp).toISOString(),
          repository,
        });
      }

      return json({
        data: templateCache[cacheKey].data,
        cached: true,
        cachedAt: new Date(templateCache[cacheKey].timestamp).toISOString(),
        repository,
      });
    }

    // Cache miss or expired, fetch from GitHub
    console.log(`Cache miss for template: ${cacheKey}, fetching from GitHub`);

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

    const repository = await createRepository(
      env,
      userAccessToken,
      email,
      projectRepo || `template-${templateName}-${Date.now()}`,
      projectSummary || '',
    );

    // If registerToRepo is true, commit the template to the repository
    if (files) {
      await commitFilesToRepo(env, userAccessToken, email, repository.name, files, 'Initial Commit');
      return json({
        data: messages,
        cached: false,
        repository,
      });
    }

    return json({
      data: messages,
      cached: false,
      repository,
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
