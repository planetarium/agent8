import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('gitCommandsApi');

export const loader = withV8AuthUser(gitCommandsLoader, { checkCredit: true });

/**
 * GET /api/gitlab/git-commands
 * Get git commands and setup instructions for a project
 */
async function gitCommandsLoader({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');

  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  try {
    const gitlabService = new GitlabService(env);

    // Get project and verify ownership (simple check)
    const project = await gitlabService.gitlab.Projects.show(projectPath);
    const projectOwner = await gitlabService.getOrCreateUser(user.email);

    // Simple ownership check - GitLab already validates access
    if (project.namespace?.id !== projectOwner.namespace_id) {
      return json({ success: false, message: 'Only project owner can get git commands' }, { status: 403 });
    }

    // Check if there's an active token
    const tokenStatus = await gitlabService.getActiveDevToken(project.id);

    const gitlabHost = gitlabService.gitlabUrl.replace('https://', '');
    const gitUrl = `${gitlabService.gitlabUrl}/${projectPath}.git`;

    // Generate commands based on token availability
    const commands = {
      projectInfo: {
        path: projectPath,
        gitUrl,
        defaultBranch: project.default_branch || 'develop',
        hasActiveToken: tokenStatus.hasToken,
        tokenExpiresAt: tokenStatus.expiresAt,
        daysLeft: tokenStatus.daysLeft,
      },
      setup: {
        clone: tokenStatus.hasToken
          ? `# Clone with existing token (ask project owner for current token)\ngit clone https://oauth2:YOUR_TOKEN@${gitlabHost}/${projectPath}.git`
          : `# No active token - create one first through the web interface\n# Then use: git clone https://oauth2:YOUR_TOKEN@${gitlabHost}/${projectPath}.git`,

        remoteUpdate: [
          '# Update existing local repository with new token:',
          `git remote set-url origin https://oauth2:YOUR_TOKEN@${gitlabHost}/${projectPath}.git`,
          '# Verify the remote URL:',
          'git remote -v',
        ],

        basicWorkflow: [
          '# Basic development workflow:',
          `cd ${projectPath.split('/')[1]}`,
          'git checkout develop',
          'git pull origin develop',
          'git checkout -b feature/your-feature-name',
          '# Make your changes...',
          'git add .',
          'git commit -m "Your commit message"',
          'git push origin feature/your-feature-name',
        ],

        branchStrategy: [
          '# Branch strategy:',
          '# - main: Production branch (protected)',
          '# - develop: Development branch (default)',
          '# - task-*: Task branches (auto-created by Agent8)',
          '# - feature/*: Your feature branches',
          '',
          '# Always branch from develop:',
          'git checkout develop',
          'git pull origin develop',
          'git checkout -b feature/your-feature',
        ],
      },
      troubleshooting: [
        '# Common issues and solutions:',
        '',
        '# 1. Authentication failed:',
        '#    - Check if your token is still valid',
        '#    - Update remote URL with new token',
        '',
        '# 2. Permission denied:',
        '#    - Ensure you have Developer access to the project',
        '#    - Check if token has correct scopes (read_repository, write_repository)',
        '',
        '# 3. Push rejected:',
        '#    - Pull latest changes: git pull origin develop',
        '#    - Resolve conflicts if any',
        '#    - Try push again',
        '',
        '# 4. Token expired:',
        '#    - Generate new token through web interface',
        '#    - Update remote URL with new token',
      ],
      security: [
        '# Security best practices:',
        '',
        '# 1. Token security:',
        '#    - Never commit tokens to repository',
        '#    - Use credential manager when possible',
        '#    - Revoke unused tokens regularly',
        '',
        '# 2. Git credential management:',
        'git config --global credential.helper store',
        '#    (Stores credentials in plain text - use with caution)',
        '',
        '# 3. Or use credential manager (recommended):',
        '#    - macOS: git config --global credential.helper osxkeychain',
        '#    - Windows: git config --global credential.helper manager',
        '#    - Linux: git config --global credential.helper libsecret',
      ],
    };

    return json({
      success: true,
      data: commands,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to get git commands', { projectPath, error: errorMessage });

    return json({ success: false, message: `Failed to get git commands: ${errorMessage}` }, { status: 500 });
  }
}
