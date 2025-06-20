import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { getMCPConfigFromCookie } from '~/lib/api/cookies';

export const action = withV8AuthUser(updateTaskBranchAction);

const logger = createScopedLogger('api.gitlab.task-update-branch');

interface RequestBody {
  projectPath: string;
  userInput: string;
  llmResponse: string;
}

async function updateTaskBranchAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  if (!context?.user) {
    return json({ success: false, message: 'Unauthorized: User not authenticated' }, { status: 401 });
  }

  const user = context.user as { email: string; isActivated: boolean };

  try {
    const { projectPath, userInput, llmResponse } = (await request.json()) as RequestBody;

    if (!projectPath || !userInput || !llmResponse) {
      return json(
        { success: false, message: 'Project path, user input, and LLM response are required' },
        { status: 400 },
      );
    }

    const gitlabService = new GitlabService(env);

    // Verify the user owns this project
    const isOwner = await gitlabService.isProjectOwner(user.email, projectPath);

    if (!isOwner) {
      return json({ success: false, message: 'You do not have permission to access this project' }, { status: 403 });
    }

    // Get project info by extracting project name from path
    const projectName = projectPath.split('/').pop();

    if (!projectName) {
      return json({ success: false, message: 'Invalid project path' }, { status: 400 });
    }

    const gitlabUser = await gitlabService.getOrCreateUser(user.email);
    const project = await gitlabService.getProject(gitlabUser, projectName);
    const branch = 'task';

    logger.info(`LLM response length: ${llmResponse.length}`);
    logger.info(`LLM response preview: ${llmResponse.substring(0, 500)}...`);

    // Extract JSON from the LLM response
    const jsonMatch = llmResponse.match(/<div class="__taskBreakdown__">(.*?)<\/div>/s);
    let taskBreakdown = null;

    if (jsonMatch) {
      logger.info(`Found JSON match, attempting to parse...`);

      try {
        taskBreakdown = JSON.parse(jsonMatch[1]);
        logger.info(`Successfully parsed task breakdown with ${taskBreakdown.tasks?.length || 0} tasks`);
      } catch (e) {
        logger.error('Failed to parse task breakdown JSON:', e);
        logger.error('Raw JSON content:', jsonMatch[1]);
      }
    } else {
      logger.warn('No __taskBreakdown__ div found in response');
      logger.info('Full response for debugging:', llmResponse);
    }

    // Step 3: Create GitLab issues if requested and breakdown is available
    let taskResults: { issues: any[]; errors: any[]; issueIdMap: Map<any, any> } = {
      issues: [],
      errors: [],
      issueIdMap: new Map(),
    };

    if (taskBreakdown?.tasks) {
      const cookieHeader = request.headers.get('Cookie');
      const mcpConfig = getMCPConfigFromCookie(cookieHeader);

      taskResults = await createGitlabIssuesFromTasks(
        gitlabService,
        project.path_with_namespace,
        taskBreakdown.tasks,
        mcpConfig,
      );
      logger.info(`Created ${taskResults.issues.length} GitLab issues, ${taskResults.errors.length} errors`);
    }

    const cleanUserPrompt = extractCleanUserPrompt(userInput);

    // Step 4: Commit task log to branch
    const fileName = `task-history/task-${Date.now()}.json`;
    const commitTitle = cleanUserPrompt.slice(0, 40).replace(/\n/g, '');
    const commitMsg = `${commitTitle}\n\n<V8Metadata>${JSON.stringify({ Branch: branch })}</V8Metadata>\n<V8UserMessage>\n${userInput}\n</V8UserMessage>\n<V8AssistantMessage>\n${llmResponse}\n</V8AssistantMessage>\n`;

    const filesToCommit = [
      {
        path: fileName,
        content: JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            userPrompt: userInput,
            taskBreakdown,
            gitlabIssues: taskResults.issues,
          },
          null,
          2,
        ),
      },
    ];

    try {
      await gitlabService.commitFiles(project.id, filesToCommit, commitMsg, branch);
      logger.info(`Committed task breakdown to GitLab branch ${branch} as ${fileName}`);
    } catch (e: any) {
      logger.warn('Failed to commit task breakdown to GitLab branch: ' + (e?.message || e));
    }

    return json({
      success: true,
      data: {
        branchName: branch,
        logFileName: fileName,
        issuesCount: taskResults.issues.length,
        projectPath: project.path_with_namespace,
        issues: taskResults.issues,
      },
    });
  } catch (error: any) {
    logger.error('Failed to update task branch:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return json(
      {
        success: false,
        message: `Failed to create task branch: ${errorMessage}`,
      },
      { status: 500 },
    );
  }
}

function formatMcpMetadataNote(recommendedMcpTools: string[], mcpConfig: any): string | null {
  const validMcpTools = recommendedMcpTools.filter((toolName) => {
    const hasUnderscore = toolName.includes('_');
    const prefix = toolName.split('_')[0];
    const serverConfig = mcpConfig.servers[prefix];
    const isValidPrefix = serverConfig && serverConfig.enabled;

    if (!hasUnderscore || !isValidPrefix) {
      logger.warn(`Invalid MCP tool name filtered out: ${toolName}`);
      return false;
    }

    return true;
  });

  if (validMcpTools.length === 0) {
    logger.info('No valid MCP tools found, skipping internal note creation');
    return null;
  }

  const serverPrefixes = new Set(
    validMcpTools
      .map((toolName) => {
        const prefix = toolName.split('_')[0];
        return prefix;
      })
      .filter((prefix) => mcpConfig.servers[prefix] && mcpConfig.servers[prefix].enabled),
  );

  const servers = Array.from(serverPrefixes).map((serverName) => ({
    name: serverName,
    url: mcpConfig.servers[serverName].url,
  }));

  const mcpMetadata = { servers };

  return `<!-- MCP_METADATA -->
${JSON.stringify(mcpMetadata, null, 2)}
<!-- MCP_METADATA -->`;
}

// Helper function to create GitLab issues from tasks
async function createGitlabIssuesFromTasks(
  gitlabService: GitlabService,
  projectPath: string,
  tasks: any[],
  mcpConfig: any,
) {
  const issues: any[] = [];
  const errors: any[] = [];
  const issueIdMap = new Map();

  for (const task of tasks) {
    try {
      const issueData = {
        title: task.title,
        description: `${task.description}\n\n**Details:**\n${task.details}\n\n**Test Strategy:**\n${task.testStrategy}\n\n**Priority:** ${task.priority}`,
        labels: [task.priority, 'TODO', 'agentic'],
      };

      // Use GitLab API directly since createIssue method doesn't exist
      const issue = await gitlabService.gitlab.Issues.create(projectPath, issueData.title, {
        description: issueData.description,
        labels: issueData.labels.join(','),
      });

      // Add internal note with MCP tools information
      try {
        // Only create internal note if there are recommended MCP tools
        if (task.recommendedMcpTools && task.recommendedMcpTools.length > 0) {
          const mcpToolsNote = formatMcpMetadataNote(task.recommendedMcpTools, mcpConfig);

          if (mcpToolsNote) {
            await gitlabService.createIssueInternalNote(projectPath, issue.iid, mcpToolsNote);
            logger.info(
              `Added internal note to issue #${issue.iid} with MCP tools: ${task.recommendedMcpTools.join(', ')}`,
            );
          }
        } else {
          logger.info(`No MCP tools recommended for issue #${issue.iid}, skipping internal note creation`);
        }
      } catch (noteError: any) {
        logger.error(`Failed to add internal note to issue #${issue.iid}:`, noteError);
      }

      issues.push(issue);
      issueIdMap.set(task.id, issue.iid);

      logger.info(`Created GitLab issue successfully #${issue.iid}: ${task.title}`);
    } catch (error: any) {
      logger.error(`Failed to create GitLab issue for task: ${task.title}`, error);
      errors.push({
        task: task.title,
        error: error.message,
      });
    }
  }

  return {
    issues,
    errors,
    issueIdMap,
  };
}

// Helper function to extract clean user prompt from the full user input
function extractCleanUserPrompt(userInput: string): string {
  const lines = userInput.split('\n');
  const cleanLines = lines.filter((line) => {
    const trimmed = line.trim();
    return (
      !trimmed.startsWith('[Model:') &&
      !trimmed.startsWith('[Provider:') &&
      !trimmed.startsWith('[Attachments:') &&
      !trimmed.startsWith('<think>') &&
      !trimmed.startsWith('</think>') &&
      trimmed !== ''
    );
  });

  let inThinkBlock = false;
  const finalLines = cleanLines.filter((line) => {
    if (line.trim().startsWith('<think>')) {
      inThinkBlock = true;
      return false;
    }

    if (line.trim().startsWith('</think>')) {
      inThinkBlock = false;
      return false;
    }

    return !inThinkBlock;
  });

  return finalLines.join('\n').trim();
}
