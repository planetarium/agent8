import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { generateId, generateText } from 'ai';
import { getMCPConfigFromCookie } from '~/lib/api/cookies';
import { createToolSet } from '~/lib/modules/mcp/toolset';
import { DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import { type FileMap } from '~/lib/.server/llm/constants';
import { createFileSearchTools } from '~/lib/.server/llm/tools/file-search';
import { createDocTools } from '~/lib/.server/llm/tools/docs';
import { createSearchCodebase, createSearchResources } from '~/lib/.server/llm/tools/vectordb';
import {
  getProjectFilesPrompt,
  getProjectPackagesPrompt,
  getResourceSystemPrompt,
  getProjectMdPrompt,
} from '~/lib/common/prompts/agent8-prompts';

// GitLab integration
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import type { GitlabProject, GitlabIssue } from '~/lib/persistenceGitbase/types';

// Define message types
type TaskMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export const action = withV8AuthUser(taskAction, { checkCredit: true });

const logger = createScopedLogger('api.task');

interface TaskBreakdownRequest {
  messages: TaskMessage[];
  createGitlabIssues?: boolean;
  projectName?: string;
  projectDescription?: string;
  existingProjectPath?: string;
  files?: FileMap;
}

interface TaskMasterTask {
  id: string;
  title: string;
  description: string;
  details: string;
  testStrategy: string;
  priority: 'high' | 'medium' | 'low';
  dependencies: string[];
}

interface TaskMasterResult {
  summary: string;
  tasks: TaskMasterTask[];
  totalTasks: number;
  generatedAt: string;
  metadata: {
    projectName: string;
    sourceFile: string;
    totalTasks: number;
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
    .join('-');

  // Use full timestamp
  const timestamp = Date.now();

  return `${cleanPrompt}-${timestamp}`;
}

// Extract user prompt from messages
function extractUserPrompt(messages: TaskMessage[]): string {
  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  throw new Error('No user message found in messages array');
}

// Build advanced system prompt for task breakdown
function buildTaskBreakdownSystemPrompt(): string {
  return `You are an AI project task breakdown expert specialized in analyzing Product Requirements Documents (PRDs) or user requirements and breaking them down into structured development tasks.

Analyze the provided requirement content and generate a concise list of top-level development tasks, with no more than 15 tasks. Each task should represent a logical unit of work needed to implement the requirements, focusing on the most direct and effective implementation approach while avoiding unnecessary complexity or over-engineering.

**Task Breakdown Guidelines:**
1. Each task should be atomic and focused on a single responsibility, following the latest best practices and standards
2. Order tasks logically - consider dependencies and implementation sequence
3. Early tasks should focus on setup and core functionality, then advanced features
4. Include clear validation/testing approach for each task
5. Set appropriate dependency IDs (tasks can only depend on tasks with lower IDs)
6. Assign priority (high/medium/low) based on criticality and dependency order
7. Include detailed implementation guidance in the "details" field
8. If requirements contain specific libraries, database schemas, frameworks, tech stacks, or other implementation details, STRICTLY ADHERE to these requirements
9. Focus on filling gaps left by requirements or areas that aren't fully specified, while preserving all explicit requirements
10. Always provide the most direct path to implementation, avoiding over-engineering or roundabout approaches
11. Include specific, actionable guidance for each task
12. Set reasonable estimated time and acceptance criteria

**Respond strictly in the following JSON format, without any explanation or markdown formatting:**

{
  "summary": "Task breakdown summary description",
  "tasks": [
    {
      "id": "1",
      "title": "Task title",
      "description": "Task description", 
      "details": "Detailed implementation guidance and technical details",
      "testStrategy": "Validation and testing approach",
      "priority": "high|medium|low",
      "dependencies": ["Dependent task IDs"],
    }
  ],
  "totalTasks": number_of_tasks,
  "generatedAt": "ISO_timestamp",
  "metadata": {
    "projectName": "Project name",
    "sourceFile": "Source file",
    "totalTasks": number_of_tasks
  }
}`;
}

// Parse task breakdown response from LLM
function parseTaskBreakdownResponse(response: string, _userPrompt: string): TaskMasterResult {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('No valid JSON found in LLM response');
    }

    let jsonStr = jsonMatch[0];
    let taskData;

    try {
      // Try to parse the JSON normally first
      taskData = JSON.parse(jsonStr);
    } catch (jsonError: any) {
      // If JSON parsing failed, attempt to fix potential truncation issues
      logger.warn('Initial JSON parse failed:', jsonError.message);

      // Check if error is due to truncation
      if (
        jsonError.message.includes('Unexpected end of JSON input') ||
        jsonError.message.includes('Expected') ||
        jsonError.message.includes('Unterminated')
      ) {
        logger.info('Attempting to fix potentially truncated JSON...');

        /* Fix common JSON truncation issues */
        // 1. Check for missing closing braces
        const openBraces = (jsonStr.match(/\{/g) || []).length;
        const closeBraces = (jsonStr.match(/\}/g) || []).length;

        if (openBraces > closeBraces) {
          // Add missing closing braces
          jsonStr += '}'.repeat(openBraces - closeBraces);
          logger.debug('Added missing closing braces');
        }

        // 2. Check for missing closing brackets
        const openBrackets = (jsonStr.match(/\[/g) || []).length;
        const closeBrackets = (jsonStr.match(/\]/g) || []).length;

        if (openBrackets > closeBrackets) {
          // Add missing closing brackets after the last object
          const lastBraceIndex = jsonStr.lastIndexOf('}');

          if (lastBraceIndex !== -1) {
            const closingBrackets = ']'.repeat(openBrackets - closeBrackets);
            jsonStr = `${jsonStr.slice(0, lastBraceIndex + 1)}${closingBrackets}${jsonStr.slice(lastBraceIndex + 1)}`;
            logger.debug('Added missing closing brackets');
          }
        }

        // 3. Fix truncated property values
        jsonStr = jsonStr.replace(/,\s*"[^"]*"\s*:(?!\s*[{\["0-9]|true|false|null)/g, (match) => {
          logger.debug(`Found potentially truncated property: ${match}`);
          return `${match} ""`;
        });

        // Try parsing JSON again after fixes
        try {
          taskData = JSON.parse(jsonStr);
          logger.info('Successfully fixed and parsed JSON');
        } catch (retryError) {
          logger.error('Failed to fix JSON:', retryError);
          throw new Error(`Failed to parse JSON after fix attempts: ${jsonError.message}`);
        }
      } else {
        // If not a truncation error, rethrow original error
        throw jsonError;
      }
    }

    // Validate and transform the response to match TaskMasterResult format
    const tasks: TaskMasterTask[] = (taskData.tasks || []).map((task: any, index: number) => ({
      id: task.id?.toString() || (index + 1).toString(),
      title: task.title || 'Untitled Task',
      description: task.description || '',
      details: task.details || '',
      testStrategy: task.testStrategy || '',
      priority: ['high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium',
      dependencies: Array.isArray(task.dependencies) ? task.dependencies.map((dep: any) => dep.toString()) : [],
    }));

    return {
      summary: taskData.summary || `Task breakdown completed: ${tasks.length} tasks`,
      tasks,
      totalTasks: tasks.length,
      generatedAt: new Date().toISOString(),
      metadata: {
        projectName: taskData.metadata?.projectName || 'User Requirements Project',
        sourceFile: taskData.metadata?.sourceFile || 'API Request',
        totalTasks: tasks.length,
      },
    };
  } catch (error: any) {
    logger.error('Failed to parse task breakdown response:', error);

    // Since we removed the fallback, just throw the error
    throw new Error(`Failed to parse LLM response: ${error.message}`);
  }
}

// Execute task breakdown using generateText with MCP tools
async function executeEnhancedTaskBreakdown(
  userPrompt: string,
  env: any,
  cookieHeader: string | null,
  userAccessToken?: string,
  files?: FileMap,
): Promise<TaskMasterResult> {
  try {
    logger.info('Starting enhanced task breakdown execution');

    // Setup MCP tools from cookie
    const mcpConfig = getMCPConfigFromCookie(cookieHeader);
    const mcpToolset = await createToolSet(mcpConfig, userAccessToken);
    const mcpTools = mcpToolset.tools;
    logger.info(`MCP tools count: ${Object.keys(mcpTools).length}`);

    // Build messages for task breakdown
    const systemPrompt = buildTaskBreakdownSystemPrompt();
    const userMessage = `Please break down the following requirements into specific development tasks:\n\n${userPrompt}`;

    // Validate message content
    if (!systemPrompt || systemPrompt.trim().length === 0) {
      throw new Error('System prompt is empty');
    }

    if (!userMessage || userMessage.trim().length === 0) {
      throw new Error('User message is empty');
    }

    logger.debug('Message validation:', {
      systemPromptLength: systemPrompt.length,
      userMessageLength: userMessage.length,
      userPromptPreview: userPrompt.slice(0, 100),
    });

    // Debug providers
    logger.debug(`Available providers: ${PROVIDER_LIST.map((p) => p.name).join(', ')}`);
    logger.debug(`DEFAULT_PROVIDER: ${DEFAULT_PROVIDER.name}`);

    // Get the provider and model instance (similar to streamText)
    const provider = PROVIDER_LIST.find((p) => p.name === 'Google') || DEFAULT_PROVIDER;
    logger.debug(`Selected provider: ${provider.name}`);

    // Get model instance using provider directly, similar to how streamText does it
    logger.debug(
      `API Key available: ${!!env.GOOGLE_GENERATIVE_AI_API_KEY}, length: ${env.GOOGLE_GENERATIVE_AI_API_KEY?.length || 0}`,
    );

    const modelInstance = provider.getModelInstance({
      model: 'gemini-2.5-pro-preview-05-06',
      serverEnv: env,
    });

    logger.debug('Using Google model: gemini-2.5-pro-preview-05-06');

    // Initialize tools with MCP tools
    let combinedTools: Record<string, any> = { ...mcpTools };

    // Add additional tools if available
    if (env) {
      const docTools = await createDocTools(env as Env);
      const codebaseTools = await createSearchCodebase(env as Env);
      const resourcesTools = await createSearchResources(env as Env);
      combinedTools = {
        ...combinedTools,
        ...docTools,
        ...codebaseTools,
        ...resourcesTools,
      };
    }

    logger.info(`combinedTools length: ${Object.keys(combinedTools)}`);

    // Add file search tools if files are provided
    if (files) {
      logger.info('Adding file search tools to task breakdown');

      const fileSearchTools = createFileSearchTools(files);
      combinedTools = {
        ...combinedTools,
        ...fileSearchTools,
      };
    }

    logger.info(`combinedTools after file search tools length: ${Object.keys(combinedTools)}`);

    // Create system messages array
    const systemMessages = [
      {
        role: 'system' as const,
        content: systemPrompt,
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      },
    ];

    // Add project context if files are provided
    if (files) {
      logger.info('Adding project context to task breakdown');

      systemMessages.push({
        role: 'system' as const,
        content: getProjectFilesPrompt(files),
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      });

      // Add package.json context if available
      systemMessages.push({
        role: 'system' as const,
        content: getProjectPackagesPrompt(files),
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      });

      // Add resource system prompt
      systemMessages.push({
        role: 'system' as const,
        content: getResourceSystemPrompt(files),
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      });

      // Add PROJECT.md context if available
      systemMessages.push({
        role: 'system' as const,
        content: getProjectMdPrompt(files),
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      });
    }

    // Add user message
    const userMessages = [
      {
        role: 'user' as const,
        content: userMessage,
      },
    ];

    // Combine all messages
    const messages = [...systemMessages, ...userMessages];

    logger.info('🔄 Calling generateText with tools and project context...');

    // Setup generateText parameters with tools
    const generateParams: any = {
      model: modelInstance,
      messages,
      temperature: 0.3,
    };

    // Only add tools if we have them
    if (Object.keys(combinedTools).length > 0) {
      logger.info(`Adding ${Object.keys(combinedTools).length} tools to request`);
      generateParams.tools = combinedTools;
      generateParams.toolChoice = 'auto';
    }

    // Use LLM call with tools
    const result = await generateText(generateParams);

    logger.info('✅ generateText call successful');

    const fullResponse = result.text;

    // 打印工具调用和模型信息统计
    logger.info(
      `🔧 工具调用统计: ${JSON.stringify(
        {
          toolCallsCount: result.toolCalls?.length || 0,
          toolResultsCount: result.toolResults?.length || 0,
          stepsCount: result.steps?.length || 0,
        },
        null,
        2,
      )}`,
    );

    // 记录详细的工具调用和结果信息
    logger.debug('详细工具和步骤信息:');
    logger.debug(`工具调用详情: ${JSON.stringify(result.toolCalls, null, 2)}`);
    logger.debug(`工具结果详情: ${JSON.stringify(result.toolResults, null, 2)}`);
    logger.debug(`步骤详情: ${JSON.stringify(result.steps, null, 2)}`);

    // Parse the response
    const taskBreakdown = parseTaskBreakdownResponse(fullResponse, userPrompt);
    logger.info(`✨ Task breakdown completed: ${taskBreakdown.tasks.length} tasks`);

    return taskBreakdown;
  } catch (error: any) {
    logger.error('Enhanced task breakdown execution failed:', error);
    throw new Error(`Task breakdown failed: ${error.message}`);
  }
}

// Create conversation response with history
function createConversationResponse(
  messages: TaskMessage[],
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
    content: `I've broken down your requirements into ${taskBreakdown.tasks.length} specific tasks${gitlabResult ? ` and created corresponding issues in GitLab project ${gitlabResult.projectPath}` : ''}.`,
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
          projectPath: gitlabResult.projectPath,
        },
      }),

      // API status
      apiKeysConfigured: {
        anthropic: !!env?.ANTHROPIC_API_KEY,
        openai: !!env?.OPENAI_API_KEY,
        google: !!env?.GOOGLE_GENERATIVE_AI_API_KEY,
        openrouter: !!env?.OPEN_ROUTER_API_KEY,
        gitlab: !!(env?.GITLAB_URL && env?.GITLAB_ACCESS_TOKEN),
      },
    },
  };
}

// Format task description for GitLab issue
function formatTaskDescription(task: TaskMasterTask, taskToIssueMap?: Map<string, number>): string {
  let description = task.description;

  if (task.details) {
    description += `\n\n**Implementation Details:**\n${task.details}`;
  }

  if (task.testStrategy) {
    description += `\n\n**Test Strategy:**\n${task.testStrategy}`;
  }

  if (task.dependencies && task.dependencies.length > 0) {
    description += `\n\n**Dependent Tasks:**`;

    task.dependencies.forEach((depId) => {
      if (taskToIssueMap?.has(depId)) {
        const issueNumber = taskToIssueMap.get(depId);
        description += `\n- Issue #${issueNumber}`;
      } else {
        description += `\n- Task ${depId}`;
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
          labels: [`priority-${task.priority}`, 'type-development'],
        },
      );

      issues.push(issue);
      taskToIssueMap.set(task.id, issue.iid);
      logger.info(`Created GitLab issue successfully #${issue.iid}: ${task.title}`);
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

async function taskAction({ context, request }: ActionFunctionArgs) {
  try {
    const body = await request.json<TaskBreakdownRequest>();
    const {
      messages,
      createGitlabIssues,
      projectName: requestProjectName,
      projectDescription: requestProjectDescription,
      existingProjectPath,
      files,
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
    logger.debug(
      `Environment variables: GOOGLE_GENERATIVE_AI_API_KEY exists: ${!!env.GOOGLE_GENERATIVE_AI_API_KEY}, length: ${env.GOOGLE_GENERATIVE_AI_API_KEY?.length || 0}`,
    );

    const user = context?.user as { email: string; isActivated: boolean };
    const cookieHeader = request.headers.get('Cookie');

    // Step 1: Execute enhanced task breakdown using our own implementation
    const taskBreakdown = await executeEnhancedTaskBreakdown(
      userPrompt,
      env,
      cookieHeader,
      user?.email ? 'user-access-token' : undefined,
      files,
    );
    logger.info(`Task breakdown completed, generated ${taskBreakdown.tasks.length} tasks`);

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
              `Unable to find project at path: ${existingProjectPath}. Error: ${error.message || 'Unknown error'}`,
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
