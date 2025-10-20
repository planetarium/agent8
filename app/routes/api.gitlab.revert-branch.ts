import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { logger } from '~/utils/logger';

export const action = withV8AuthUser(revertBranchAction);

/**
 * Action function for reverting a branch to a specific commit
 */
async function revertBranchAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  if (request.method !== 'POST') {
    return json(
      { success: false, message: 'Method not allowed' },
      {
        status: 405,
        headers: {
          Allow: 'POST',
        },
      },
    );
  }

  try {
    // Get request body as JSON
    const requestData = (await request.json()) as {
      projectPath: string;
      branchName: string;
      commitHash: string;
    };

    const { projectPath, branchName, commitHash } = requestData;

    // Validate required parameters
    if (!projectPath) {
      return json({ success: false, message: 'Project path is required' }, { status: 400 });
    }

    if (!branchName) {
      return json({ success: false, message: 'Branch name is required' }, { status: 400 });
    }

    if (!commitHash) {
      return json({ success: false, message: 'Commit hash is required' }, { status: 400 });
    }

    const gitlabService = new GitlabService(env);

    // Get or create GitLab user to verify permissions
    const gitlabUser = await gitlabService.getOrCreateUser(user.email);
    const project = await gitlabService.findProject(gitlabUser.username, projectPath.split('/')[1]);

    // Check if user has permission to modify this project
    const hasPermission = await gitlabService.isProjectOwner(user.email, project.id);

    if (!hasPermission) {
      return json(
        { success: false, message: 'You do not have permission to revert branches in this project' },
        { status: 403 },
      );
    }

    // Revert the branch
    const result = await gitlabService.revertBranchToCommit(project.id, branchName, commitHash);

    logger.info(`Branch ${branchName} reverted to commit ${commitHash}`, result);

    return json({
      success: true,
      data: {
        message: result.message,
        branchName: result.branchName,
        revertedToCommit: result.revertedToCommit,
        backupBranchName: result.backupBranchName,
      },
    });
  } catch (error) {
    logger.error('Failed to revert branch:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return json(
      {
        success: false,
        message: `Failed to revert branch: ${errorMessage}`,
      },
      { status: 500 },
    );
  }
}
