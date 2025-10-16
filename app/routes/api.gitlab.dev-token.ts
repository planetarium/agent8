import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('devTokenApi');

export const action = withV8AuthUser(devTokenAction, { checkCredit: true });
export const loader = withV8AuthUser(devTokenLoader, { checkCredit: true });

/**
 * GET /api/gitlab/dev-token
 * Get dev token status for a project
 */
async function devTokenLoader({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');

  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  try {
    const gitlabService = new GitlabService(env);

    // Get project and verify ownership using dedicated method
    const project = await gitlabService.gitlab.Projects.show(projectPath);
    const isOwner = await gitlabService.isProjectOwner(user.email, project.id);

    if (!isOwner) {
      return json(
        {
          success: false,
          message: 'Access denied: You are not the owner of this project',
          error: 'PERMISSION_DENIED',
          details: 'Only project owners can view token status',
        },
        { status: 403 },
      );
    }

    // Get active dev token status and active tokens list only
    const tokenStatus = await gitlabService.getActiveDevToken(project.id);
    const tokensList = await gitlabService.getActiveDevTokensList(project.id);

    return json({
      success: true,
      data: {
        projectPath,
        ...tokenStatus,
        tokens: tokensList,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to get dev token status', { projectPath, error: errorMessage });

    return json({ success: false, message: `Failed to get dev token status: ${errorMessage}` }, { status: 500 });
  }
}

/**
 * POST /api/gitlab/dev-token
 * Create new dev token (revokes existing ones)
 */
async function devTokenAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  if (request.method === 'POST') {
    return await createDevToken({ context, request }, env, user);
  }

  if (request.method === 'DELETE') {
    const body = (await request.json()) as { projectPath: string; tokenId?: number };

    if (body.tokenId) {
      return await revokeDevToken({ context, request }, env, user, body.tokenId, body.projectPath);
    } else {
      return await revokeAllDevTokens({ context, request }, env, user, body.projectPath);
    }
  }

  return json({ success: false, message: 'Method not allowed' }, { status: 405 });
}

/**
 * Create new dev token
 */
async function createDevToken(
  args: { context: any; request: Request },
  env: Env,
  user: { email: string; isActivated: boolean },
) {
  try {
    const body = (await args.request.json()) as { projectPath: string };
    const { projectPath } = body;

    if (!projectPath) {
      return json({ success: false, message: 'Project path is required' }, { status: 400 });
    }

    const gitlabService = new GitlabService(env);

    // Get project and verify ownership using dedicated method
    const project = await gitlabService.gitlab.Projects.show(projectPath);
    const isOwner = await gitlabService.isProjectOwner(user.email, project.id);

    if (!isOwner) {
      return json(
        {
          success: false,
          message: 'Access denied: You are not the owner of this project',
          error: 'PERMISSION_DENIED',
          details: 'Only project owners can create development tokens',
        },
        { status: 403 },
      );
    }

    // Create new dev token (this will revoke existing ones)
    const tokenData = await gitlabService.createDevToken(project.id);

    const gitUrl = `${gitlabService.gitlabUrl}/${projectPath}.git`;
    const cloneCommand = `git clone -b develop https://oauth2:${tokenData.token}@${gitlabService.gitlabUrl.replace('https://', '')}/${projectPath}.git`;

    return json({
      success: true,
      data: {
        token: tokenData.token, // Only exposed once
        projectPath,
        gitUrl,
        cloneCommand,
        expiresAt: tokenData.expires_at,
        expiresInDays: 30,
        scopes: tokenData.scopes,
        accessLevel: tokenData.access_level,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to create dev token', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return json({ success: false, message: `Failed to create dev token: ${errorMessage}` }, { status: 500 });
  }
}

/**
 * Revoke all dev tokens
 */
async function revokeAllDevTokens(
  args: { context: any; request: Request },
  env: Env,
  user: { email: string; isActivated: boolean },
  projectPath: string,
) {
  try {
    if (!projectPath) {
      return json({ success: false, message: 'Project path is required' }, { status: 400 });
    }

    const gitlabService = new GitlabService(env);

    // Get project and verify ownership using dedicated method
    const project = await gitlabService.gitlab.Projects.show(projectPath);
    const isOwner = await gitlabService.isProjectOwner(user.email, project.id);

    if (!isOwner) {
      return json(
        {
          success: false,
          message: 'Access denied: You are not the owner of this project',
          error: 'PERMISSION_DENIED',
          details: 'Only project owners can revoke development tokens',
        },
        { status: 403 },
      );
    }

    // Revoke all dev tokens
    await gitlabService.revokeAllProjectTokens(project.id);

    return json({
      success: true,
      data: {
        message: 'All dev tokens have been revoked',
        projectPath,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to revoke dev tokens', { error: errorMessage });

    return json({ success: false, message: `Failed to revoke dev tokens: ${errorMessage}` }, { status: 500 });
  }
}

/**
 * Revoke individual dev token
 */
async function revokeDevToken(
  args: { context: any; request: Request },
  env: Env,
  user: { email: string; isActivated: boolean },
  tokenId: number,
  projectPath: string,
) {
  try {
    if (!projectPath) {
      return json({ success: false, message: 'Project path is required' }, { status: 400 });
    }

    const gitlabService = new GitlabService(env);

    // Get project and verify ownership using dedicated method
    const project = await gitlabService.gitlab.Projects.show(projectPath);
    const isOwner = await gitlabService.isProjectOwner(user.email, project.id);

    if (!isOwner) {
      return json(
        {
          success: false,
          message: 'Access denied: You are not the owner of this project',
          error: 'PERMISSION_DENIED',
          details: 'Only project owners can revoke development tokens',
        },
        { status: 403 },
      );
    }

    // Revoke specific dev token
    await gitlabService.revokeProjectToken(project.id, tokenId);
    logger.info(`Successfully revoked token ${tokenId} for project ${projectPath}`);

    return json({
      success: true,
      data: {
        message: 'Token revoked successfully',
        projectPath,
        tokenId,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to revoke dev token', { error: errorMessage, tokenId });

    return json({ success: false, message: `Failed to revoke dev token: ${errorMessage}` }, { status: 500 });
  }
}
