import type { ActionFunctionArgs } from '@remix-run/node';
import { getTemplates } from '~/utils/selectStarterTemplate';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { createScopedLogger } from '~/utils/logger';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { parseCookies } from '~/lib/api/cookies';
import type { FileMap } from '~/lib/stores/files';

const logger = createScopedLogger('api.select-template');

/*
 * In-memory cache for templates
 * Key format: `${templateName}:${title || ''}`
 */
const templateCache: Record<
  string,
  {
    data: any;
    fileMap: FileMap;
    timestamp: number;
    expiresAt: number;
  }
> = {};

export const loader = withV8AuthUser(selectTemplateAction, { checkCredit: true });

async function selectTemplateAction({ request, context }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const CACHE_TTL = env.VITE_USE_PRODUCTION_TEMPLATE === 'true' ? 24 * 60 * 60 * 1000 : 60 * 1000;
  const url = new URL(request.url);
  const templateName = url.searchParams.get('templateName');
  const title = url.searchParams.get('title') || '';
  const repo = url.searchParams.get('repo');
  const path = url.searchParams.get('path');
  const projectRepo = url.searchParams.get('projectRepo');
  const email = (context.user as { email: string }).email;

  const cookieHeader = request.headers.get('Cookie');
  const parsedCookies = parseCookies(cookieHeader || '');
  const temporaryMode = JSON.parse(parsedCookies.temporaryMode || 'false');

  if (!templateName || !repo || !path) {
    return Response.json({ error: 'templateName, repo, and path are required' }, { status: 400 });
  }

  if (!projectRepo) {
    return Response.json({ error: 'projectRepo is required' }, { status: 400 });
  }

  if (!email) {
    return Response.json({ error: 'User email is required' }, { status: 401 });
  }

  try {
    const cacheKey = `${templateName}`;
    const now = Date.now();
    let template = templateCache[cacheKey];

    // Check if we have a valid cached response
    if (!template || template.expiresAt < now) {
      // Cache miss or expired, fetch from GitHub
      logger.info(`Cache miss for template: ${cacheKey}, fetching from GitHub`);

      const { fileMap, messages, isFallback } = await getTemplates(repo, path, title, env);

      template = {
        data: messages,
        fileMap,
        timestamp: now,
        expiresAt: now + CACHE_TTL,
      };

      if (!isFallback) {
        // Store in cache
        templateCache[cacheKey] = template;
      }
    }

    const gitlabService = new GitlabService(env, temporaryMode);
    const fileMap = template.fileMap;

    if (gitlabService.enabled) {
      const files = [];

      for (const key in fileMap) {
        if (fileMap[key]!.type === 'file') {
          files.push({
            path: key,
            content: fileMap[key]!.content,
          });
        }
      }

      const gitlabUser = await gitlabService.getOrCreateUser(email as string);
      const project = await gitlabService.createProject(gitlabUser, projectRepo, title);
      const commit = await gitlabService.commitFiles(project.id, files, 'Initial commit');

      return Response.json({
        data: template.data,
        fileMap,
        project: {
          id: project.id,
          name: project.name,
          path: project.path_with_namespace,
          description: project.description,
        },
        commit: { id: commit.id },
        cachedAt: new Date(template.timestamp).toISOString(),
      });
    }

    return Response.json({
      data: template.data,
      fileMap,
      cachedAt: new Date(template.timestamp).toISOString(),
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    return Response.json({ error: 'Failed to fetch template', details: (error as Error).message }, { status: 500 });
  }
}

// Optional: Add a function to clear the cache or specific entries
export async function action({ request }: ActionFunctionArgs) {
  // Only allow POST requests for cache management
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
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
          return Response.json({ success: true, message: `Cache cleared for ${cacheKey}` });
        }

        return Response.json({ success: false, message: 'Cache entry not found' });
      } else {
        // Clear all cache
        Object.keys(templateCache).forEach((key) => delete templateCache[key]);
        return Response.json({ success: true, message: 'All cache cleared' });
      }
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error processing cache action:', error);
    return Response.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
