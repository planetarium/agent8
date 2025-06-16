import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { logger } from '~/utils/logger';

export const loader = withV8AuthUser(issuesLoader, { checkCredit: true });
export const action = withV8AuthUser(issuesAction, { checkCredit: true });

/**
 * Loader function for getting project issues
 */
async function issuesLoader({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');
  const page = url.searchParams.get('page') || '1';
  const perPage = url.searchParams.get('perPage') || '20';
  const state = (url.searchParams.get('state') || 'opened') as 'opened' | 'closed' | 'all';
  const additionalLabel = url.searchParams.get('additionalLabel') || undefined;

  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  const parsedPage = parseInt(page, 10);
  const parsedPerPage = parseInt(perPage, 10);

  const gitlabService = new GitlabService(env);

  try {
    const result = await gitlabService.getProjectIssues(projectPath, parsedPage, parsedPerPage, state, additionalLabel);

    return json({
      success: true,
      data: {
        issues: result.issues,
        pagination: {
          total: result.total,
          page: parsedPage,
          perPage: parsedPerPage,
          hasMore: result.hasMore,
          totalPages: Math.ceil(result.total / parsedPerPage),
        },
      },
    });
  } catch (error) {
    logger.error('Failed to fetch project issues:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return json({ success: false, message: `Failed to fetch project issues: ${errorMessage}` }, { status: 500 });
  }
}

/**
 * Action function for updating issues
 */
async function issuesAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  if (request.method !== 'PUT') {
    return json({ success: false, message: 'Method not allowed' }, { status: 405 });
  }

  const { projectPath, issueIid, labels } = (await request.json()) as {
    projectPath: string;
    issueIid: number;
    labels: string[];
  };

  if (!projectPath || !issueIid || !labels) {
    return json({ success: false, message: 'Project path, issue IID, and labels are required' }, { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    const updatedIssue = await gitlabService.updateIssueLabels(projectPath, issueIid, labels);

    return json({
      success: true,
      data: updatedIssue,
    });
  } catch (error) {
    logger.error('Failed to update issue labels:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return json({ success: false, message: `Failed to update issue labels: ${errorMessage}` }, { status: 500 });
  }
}
