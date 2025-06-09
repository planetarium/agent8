import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { generateId } from 'ai';
import type { Messages } from '~/lib/.server/llm/stream-text';

// @ts-ignore - Task Master module doesn't have TypeScript declarations
import { parsePRD } from 'task-master-ai/scripts/modules/task-manager';
import fs from 'fs';
import path from 'path';
import os from 'os';

// GitLab integration
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import type { GitlabProject, GitlabIssue } from '~/lib/persistenceGitbase/types';

export const action = withV8AuthUser(taskAction, { checkCredit: true });

const logger = createScopedLogger('api.task');

interface TaskBreakdownRequest {
  messages: Messages;
  createGitlabIssues?: boolean;
  projectName?: string;
  projectDescription?: string;
  existingProjectPath?: string;
}

interface TaskMasterTask {
  id: string;
  title: string;
  description: string;
  type?: string;
  priority: string;
  estimatedTime?: string;
  dependencies: string[];
  status?: string;
}

interface TaskMasterResult {
  summary: string;
  tasks: TaskMasterTask[];
  totalTasks: number;
  generatedAt: string;
  metadata?: {
    projectName: string;
    sourceFile: string;
  };
}

// Generate project name from user prompt
function generateProjectName(prompt: string): string {
  // Extract meaningful keywords and create a project name (match existing project format)
  const cleanPrompt = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(' ')
    .filter((word) => word.length > 2 && !['the', 'and', 'for', 'with', 'that', 'this'].includes(word))
    .slice(0, 3)
    .join('-'); // Use hyphen to match existing projects

  // Use full timestamp (same as existing projects like basic-lol-style-game-1748328947078)
  const timestamp = Date.now();

  return `${cleanPrompt}-${timestamp}`;
}

// Extract user prompt from messages
function extractUserPrompt(messages: Messages): string {
  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  throw new Error('No user message found in messages array');
}

// Create conversation response with history
function createConversationResponse(
  messages: Messages,
  taskBreakdown: TaskMasterResult,
  gitlabResult?: {
    project: GitlabProject;
    issues: GitlabIssue[];
    projectPath: string;
  },
  env?: any,
) {
  const conversationId = generateId();
  const assistantMessage = {
    role: 'assistant' as const,
    content: `I've broken down your request into ${taskBreakdown.tasks.length} tasks${gitlabResult ? ` and created GitLab issues in project ${gitlabResult.projectPath}` : ''}.`,
  };

  return {
    success: true,
    data: {
      // Task breakdown data
      summary: taskBreakdown.summary,
      tasks: taskBreakdown.tasks,
      totalTasks: taskBreakdown.totalTasks,
      generatedAt: taskBreakdown.generatedAt,
      originalPrompt: extractUserPrompt(messages),
      metadata: taskBreakdown.metadata,

      // Conversation data
      conversationId,
      messages: [...messages, assistantMessage],

      // GitLab data (if applicable)
      ...(gitlabResult && {
        gitlab: {
          project: gitlabResult.project,
          issues: gitlabResult.issues,
          projectPath: gitlabResult.projectPath,
        },
      }),

      // API status
      apiKeysConfigured: {
        anthropic: !!env?.ANTHROPIC_API_KEY,
        openai: !!env?.OPENAI_API_KEY,
        google: !!env?.GOOGLE_API_KEY,
        gitlab: !!(env?.GITLAB_URL && env?.GITLAB_ACCESS_TOKEN),
      },
    },
  };
}

// Format task description for GitLab issue
function formatTaskDescription(task: TaskMasterTask, taskToIssueMap?: Map<string, number>): string {
  let description = task.description;

  if (task.estimatedTime) {
    description += `\n\n**Estimated Time:** ${task.estimatedTime}`;
  }

  if (task.dependencies && task.dependencies.length > 0) {
    description += `\n\n**Dependencies:**`;

    task.dependencies.forEach((depId) => {
      if (taskToIssueMap?.has(depId)) {
        const issueNumber = taskToIssueMap.get(depId);
        description += `\n- Issue #${issueNumber}`;
      } else {
        description += `\n- Issue pending`;
      }
    });
  }

  return description;
}

// Create GitLab issues from tasks with proper dependency handling
async function createIssuesFromTasks(
  gitlabService: GitlabService,
  projectPath: string,
  tasks: TaskMasterTask[],
): Promise<{
  issues: GitlabIssue[];
  errors: Array<{ task: TaskMasterTask; error: string }>;
  taskToIssueMap: Map<string, number>;
}> {
  const issues: GitlabIssue[] = [];
  const errors: Array<{ task: TaskMasterTask; error: string }> = [];
  const taskToIssueMap = new Map<string, number>();

  // Phase 1: Create issues without dependency links
  logger.info(`Creating ${tasks.length} GitLab issues...`);

  for (const task of tasks) {
    try {
      logger.debug(`Creating GitLab issue for task: ${task.title}`);

      const issue = await gitlabService.createIssue(
        projectPath,
        task.title,
        formatTaskDescription(task), // First pass without dependency links
        {
          labels: [`priority-${task.priority}`, task.type ? `type-${task.type}` : 'type-development'],
        },
      );

      issues.push(issue);
      taskToIssueMap.set(task.id, issue.iid);
      logger.info(`Created GitLab issue #${issue.iid}: ${task.title}`);
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      errors.push({ task, error: errorMessage });
      logger.error(`Failed to create GitLab issue for task "${task.title}": ${errorMessage}`);
    }
  }

  // Phase 2: Update issues with proper dependency links
  logger.info('Updating issues with dependency links...');

  for (const task of tasks) {
    if (task.dependencies && task.dependencies.length > 0 && taskToIssueMap.has(task.id)) {
      try {
        const issueIid = taskToIssueMap.get(task.id)!;
        const updatedDescription = formatTaskDescription(task, taskToIssueMap);

        await gitlabService.updateIssue(projectPath, issueIid, {
          description: updatedDescription,
        });

        logger.debug(`Updated issue #${issueIid} with dependency links`);
      } catch (error: any) {
        logger.warn(`Failed to update dependency links for issue #${taskToIssueMap.get(task.id)}: ${error.message}`);
      }
    }
  }

  return { issues, errors, taskToIssueMap };
}

async function callTaskMasterAPI(prompt: string, env: any): Promise<TaskMasterResult> {
  try {
    logger.info('Calling Task Master API for autonomous task breakdown');

    const hasAnthropicKey = env.ANTHROPIC_API_KEY;
    const hasOpenAIKey = env.OPENAI_API_KEY;

    if (!hasAnthropicKey && !hasOpenAIKey) {
      throw new Error(
        'No LLM API keys found. Please set ANTHROPIC_API_KEY or OPENAI_API_KEY in environment variables.',
      );
    }

    logger.debug(`API Keys available: Anthropic=${!!hasAnthropicKey}, OpenAI=${!!hasOpenAIKey}`);

    const tempDir = os.tmpdir();
    const tempPrdFile = path.join(tempDir, `prd-${Date.now()}-${Math.random().toString(36).substring(7)}.txt`);
    const tempTasksFile = path.join(tempDir, `tasks-${Date.now()}-${Math.random().toString(36).substring(7)}.json`);

    try {
      // Write the user prompt directly - let LLM decide completely
      fs.writeFileSync(tempPrdFile, prompt, 'utf8');
      logger.debug(`Created temporary PRD file: ${tempPrdFile}`);

      // Set up environment variables
      process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
      process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
      process.env.GOOGLE_API_KEY = env.GOOGLE_API_KEY;

      logger.info('Calling Task Master parsePRD function with autonomous mode');

      // Pass 0 to let LLM decide autonomously (will result in "approximately 0" in prompt)
      await parsePRD(tempPrdFile, tempTasksFile, 0, {
        force: true,
        append: false,
        research: false,
        mcpLog: {
          info: (msg: string) => logger.info(`TaskMaster: ${msg}`),
          warn: (msg: string) => logger.warn(`TaskMaster: ${msg}`),
          error: (msg: string) => logger.error(`TaskMaster: ${msg}`),
          debug: (msg: string) => logger.debug(`TaskMaster: ${msg}`),
          success: (msg: string) => logger.info(`TaskMaster SUCCESS: ${msg}`),
        },
      });

      // Read the generated tasks
      if (!fs.existsSync(tempTasksFile)) {
        throw new Error('Task Master did not generate tasks file');
      }

      const tasksData = JSON.parse(fs.readFileSync(tempTasksFile, 'utf8'));
      logger.info(`LLM autonomously generated ${tasksData.tasks?.length || 0} tasks`);

      // Transform Task Master format to our expected format
      const transformedTasks: TaskMasterTask[] = (tasksData.tasks || []).map((task: any) => ({
        id: task.id?.toString() || 'unknown',
        title: task.title || 'Untitled Task',
        description: task.description || '',
        type: 'development',
        priority: task.priority || 'medium',
        dependencies: (task.dependencies || []).map((dep: number) => dep.toString()),
        status: task.status || 'pending',
      }));

      const result: TaskMasterResult = {
        summary: `Autonomous task breakdown: ${transformedTasks.length} tasks generated by LLM analysis for: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`,
        tasks: transformedTasks,
        totalTasks: transformedTasks.length,
        generatedAt: new Date().toISOString(),
        metadata: tasksData.metadata || {
          projectName: 'User Request',
          sourceFile: 'API Request',
        },
      };

      return result;
    } finally {
      // Clean up temporary files
      try {
        if (fs.existsSync(tempPrdFile)) {
          fs.unlinkSync(tempPrdFile);
          logger.debug(`Cleaned up temporary PRD file: ${tempPrdFile}`);
        }

        if (fs.existsSync(tempTasksFile)) {
          fs.unlinkSync(tempTasksFile);
          logger.debug(`Cleaned up temporary tasks file: ${tempTasksFile}`);
        }
      } catch (cleanupError) {
        logger.warn(`Failed to clean up temporary files: ${cleanupError}`);
      }
    }
  } catch (error: any) {
    logger.error('Autonomous Task Master API call failed:', error);
    throw new Error(`Autonomous Task Master failed: ${error.message}`);
  }
}

async function taskAction({ context, request }: ActionFunctionArgs) {
  try {
    const body = await request.json<TaskBreakdownRequest>();
    const {
      messages,
      createGitlabIssues,
      projectName: requestProjectName,
      projectDescription: requestProjectDescription,
      existingProjectPath,
    } = body;

    if (!messages?.length) {
      return Response.json(
        {
          success: false,
          error: 'messages are required',
        },
        { status: 400 },
      );
    }

    const userPrompt = extractUserPrompt(messages);
    logger.info(`Task breakdown request: ${userPrompt.slice(0, 100)}...`);

    const env = { ...context.cloudflare.env, ...process.env } as Env;
    const user = context?.user as { email: string; isActivated: boolean };

    // Step 1: Get task breakdown from Task Master
    const taskBreakdown = await callTaskMasterAPI(userPrompt, env);
    logger.info(`Task Master generated ${taskBreakdown.tasks.length} tasks`);

    // Step 2: GitLab integration (if requested)
    if (createGitlabIssues) {
      try {
        logger.info('Starting GitLab integration...');

        const gitlabService = new GitlabService(env as any);

        // Get or create GitLab user
        const gitlabUser = await gitlabService.getOrCreateUser(user.email);
        logger.info(`GitLab user: ${gitlabUser.username}`);

        // Get or create GitLab project
        let project: GitlabProject;

        if (existingProjectPath) {
          // Use the provided project path directly
          logger.info(`Using existing project: ${existingProjectPath}`);

          try {
            const [username, projectName] = existingProjectPath.split('/');
            project = await gitlabService.findProject(username, projectName);
            logger.info(`Found existing project: ${project.path_with_namespace}`);
          } catch (error: any) {
            throw new Error(
              `Failed to find project at path: ${existingProjectPath}. Error: ${error.message || 'Unknown error'}`,
            );
          }
        } else {
          // Create new project
          const projectName = requestProjectName || generateProjectName(userPrompt);
          const projectDescription =
            requestProjectDescription ||
            `Project generated from: ${userPrompt.slice(0, 100)}${userPrompt.length > 100 ? '...' : ''}`;
          project = await gitlabService.createProject(gitlabUser, projectName, projectDescription);
        }

        logger.info(`GitLab project: ${project.path_with_namespace}`);

        // Create GitLab issues from tasks
        const issueResults = await createIssuesFromTasks(
          gitlabService,
          project.path_with_namespace,
          taskBreakdown.tasks,
        );
        logger.info(`Created ${issueResults.issues.length} GitLab issues, ${issueResults.errors.length} errors`);

        const gitlabResult = {
          project,
          issues: issueResults.issues,
          projectPath: project.path_with_namespace,
          taskToIssueMap: Object.fromEntries(issueResults.taskToIssueMap),
        };

        return Response.json(createConversationResponse(messages, taskBreakdown, gitlabResult, env));
      } catch (gitlabError: any) {
        logger.error('GitLab integration failed:', gitlabError);

        // Return task breakdown even if GitLab fails
        return Response.json(createConversationResponse(messages, taskBreakdown, undefined, env));
      }
    }

    // Return task breakdown without GitLab integration
    return Response.json(createConversationResponse(messages, taskBreakdown, undefined, env));
  } catch (error: any) {
    logger.error('Task breakdown failed:', error);
    return Response.json(
      {
        success: false,
        error: error.message || 'Task breakdown failed',
      },
      { status: 500 },
    );
  }
}
