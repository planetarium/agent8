import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.gitlab.issue');

export const loader = withV8AuthUser(issueLoader, { checkCredit: true });

/**
 * Loader function for getting a single issue
 */
async function issueLoader({ context, request, params }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');
  const issueIid = params.iid;

  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  if (!issueIid) {
    return json({ success: false, message: 'Issue IID is required' }, { status: 400 });
  }

  const parsedIssueIid = parseInt(issueIid, 10);

  if (isNaN(parsedIssueIid)) {
    return json({ success: false, message: 'Invalid issue IID' }, { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    const issue = await gitlabService.getIssue(projectPath, parsedIssueIid);

    return json({
      success: true,
      data: issue,
    });
  } catch (error) {
    logger.error('Failed to fetch issue:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return json({ success: false, message: `Failed to fetch issue: ${errorMessage}` }, { status: 500 });
  }
}
