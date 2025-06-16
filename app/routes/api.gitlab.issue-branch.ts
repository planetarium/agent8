import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.gitlab.issue-branch');

/**
 * Loader function for getting issue branch
 */
async function issueBranchLoader({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');
  const issueIid = url.searchParams.get('issueIid');

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
    const branchName = await gitlabService.getIssueBranch(projectPath, parsedIssueIid);

    return json({
      success: true,
      data: {
        branchName,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch issue branch:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return json({ success: false, message: `Failed to fetch issue branch: ${errorMessage}` }, { status: 500 });
  }
}

export const loader = issueBranchLoader;
