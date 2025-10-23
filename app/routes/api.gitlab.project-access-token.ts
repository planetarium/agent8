import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('projectAccessTokenApi');

export const action = withV8AuthUser(projectAccessTokenAction);
export const loader = withV8AuthUser(projectAccessTokenLoader);

/**
 * GET /api/gitlab/project-access-token
 * Get project access token status for a project
 */
async function projectAccessTokenLoader({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');

  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  try {
    const gitlabService = new GitlabService(env);

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

    const tokenStatus = await gitlabService.getActiveProjectAccessToken(project.id);
    const tokensList = await gitlabService.getActiveProjectAccessTokensList(project.id);

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
    logger.error('Failed to get project access token status', { projectPath, error: errorMessage });

    return json(
      { success: false, message: `Failed to get project access token status: ${errorMessage}` },
      { status: 500 },
    );
  }
}

/**
 * POST /api/gitlab/project-access-token
 * Create new project access token (revokes existing ones)
 */
async function projectAccessTokenAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  if (request.method === 'POST') {
    return await createProjectAccessToken({ context, request }, env, user);
  }

  if (request.method === 'DELETE') {
    const body = (await request.json()) as { projectPath: string; tokenId?: number };

    if (body.tokenId) {
      return await revokeProjectAccessToken({ context, request }, env, user, body.tokenId, body.projectPath);
    } else {
      return await revokeAllProjectAccessTokens({ context, request }, env, user, body.projectPath);
    }
  }

  return json({ success: false, message: 'Method not allowed' }, { status: 405 });
}

/**
 * Create new project access token
 */
async function createProjectAccessToken(
  { request }: { context: any; request: Request },
  env: Env,
  user: { email: string; isActivated: boolean },
) {
  try {
    const body = (await request.json()) as { projectPath: string };
    const { projectPath } = body;

    if (!projectPath) {
      return json({ success: false, message: 'Project path is required' }, { status: 400 });
    }

    const gitlabService = new GitlabService(env);

    const project = await gitlabService.gitlab.Projects.show(projectPath);
    const isOwner = await gitlabService.isProjectOwner(user.email, project.id);

    if (!isOwner) {
      return json(
        {
          success: false,
          message: 'Access denied: You are not the owner of this project',
          error: 'PERMISSION_DENIED',
          details: 'Only project owners can create project access tokens',
        },
        { status: 403 },
      );
    }

    const activeTokens = await gitlabService.getActiveProjectAccessTokensList(project.id);

    if (activeTokens.length >= 3) {
      return json(
        {
          success: false,
          message: 'Token limit reached: Maximum 3 active tokens allowed per project',
          error: 'TOKEN_LIMIT_EXCEEDED',
          details: 'Please revoke an existing token before creating a new one',
        },
        { status: 400 },
      );
    }

    const tokenData = await gitlabService.createProjectAccessToken(project.id, projectPath);

    const gitUrl = `${gitlabService.gitlabUrl}/${projectPath}.git`;
    const cloneCommand = `git clone -b develop https://oauth2:${tokenData.token}@${gitlabService.gitlabUrl.replace('https://', '')}/${projectPath}.git`;

    return json({
      success: true,
      data: {
        token: tokenData.token,
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
    logger.error('Failed to create project access token', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return json({ success: false, message: `Failed to create project access token: ${errorMessage}` }, { status: 500 });
  }
}

/**
 * Revoke all project access tokens
 */
async function revokeAllProjectAccessTokens(
  _args: { context: any; request: Request },
  env: Env,
  user: { email: string; isActivated: boolean },
  projectPath: string,
) {
  try {
    if (!projectPath) {
      return json({ success: false, message: 'Project path is required' }, { status: 400 });
    }

    const gitlabService = new GitlabService(env);

    const project = await gitlabService.gitlab.Projects.show(projectPath);
    const isOwner = await gitlabService.isProjectOwner(user.email, project.id);

    if (!isOwner) {
      return json(
        {
          success: false,
          message: 'Access denied: You are not the owner of this project',
          error: 'PERMISSION_DENIED',
          details: 'Only project owners can revoke project access tokens',
        },
        { status: 403 },
      );
    }

    await gitlabService.revokeAllProjectAccessTokens(project.id);

    return json({
      success: true,
      data: {
        message: 'All project access tokens have been revoked',
        projectPath,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to revoke project access tokens', { error: errorMessage });

    return json(
      { success: false, message: `Failed to revoke project access tokens: ${errorMessage}` },
      { status: 500 },
    );
  }
}

/**
 * Revoke individual project access token
 */
async function revokeProjectAccessToken(
  _args: { context: any; request: Request },
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

    const project = await gitlabService.gitlab.Projects.show(projectPath);
    const isOwner = await gitlabService.isProjectOwner(user.email, project.id);

    if (!isOwner) {
      return json(
        {
          success: false,
          message: 'Access denied: You are not the owner of this project',
          error: 'PERMISSION_DENIED',
          details: 'Only project owners can revoke project access tokens',
        },
        { status: 403 },
      );
    }

    await gitlabService.revokeProjectAccessToken(project.id, tokenId);
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
    logger.error('Failed to revoke project access token', { error: errorMessage, tokenId });

    return json({ success: false, message: `Failed to revoke project access token: ${errorMessage}` }, { status: 500 });
  }
}
