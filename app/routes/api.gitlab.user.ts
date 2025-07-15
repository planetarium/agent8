import { type LoaderFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { logger } from '~/utils/logger';

export const loader = withV8AuthUser(userLoader, { checkCredit: true });

/**
 * Loader function for getting or creating GitLab user
 */
async function userLoader({ context }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  const gitlabService = new GitlabService(env);
  const email = user.email;

  try {
    // Get or create GitLab user
    const gitlabUser = await gitlabService.getOrCreateUser(email);

    return json({
      success: true,
      data: {
        user: {
          id: gitlabUser.id,
          username: gitlabUser.username,
          email: gitlabUser.email,
          name: gitlabUser.name,
        },
      },
    });
  } catch (error) {
    logger.error('Failed to get or create GitLab user:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return json({ success: false, message: `Failed to get or create GitLab user: ${errorMessage}` }, { status: 500 });
  }
}
