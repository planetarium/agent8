import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { withV8AuthUser, type ContextUser } from '~/lib/verse8/middleware';
import { generateId, streamText } from 'ai';
import { getMCPConfigFromCookie } from '~/lib/api/cookies';
import { createToolSet } from '~/lib/modules/mcp/toolset';
import { DEFAULT_PROVIDER, PROVIDER_LIST, FIXED_MODELS } from '~/utils/constants';
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
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import { LLMManager } from '~/lib/modules/llm/manager';

// GitLab integration
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import type { GitlabProject, GitlabIssue } from '~/lib/persistenceGitbase/types';

// Define message types
type IssueMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export const action = withV8AuthUser(issueAction, { checkCredit: true });

const logger = createScopedLogger('api.issue');

interface IssueBreakdownRequest {
  messages: IssueMessage[];
  createGitlabIssues?: boolean;
  projectName?: string;
  projectDescription?: string;
  existingProjectPath?: string;
  files?: FileMap;
}

interface IssueMasterTask {
  id: string;
  title: string;
  description: string;
  details: string;
  testStrategy: string;
  priority: 'high' | 'medium' | 'low';
  dependencies: string[];
}

interface IssueMasterResult {
  summary: string;
  issues: IssueMasterTask[];
  totalIssues: number;
  generatedAt: string;
  metadata: {
    projectName: string;
    sourceFile: string;
    totalIssues: number;
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
function extractUserPrompt(messages: IssueMessage[]): string {
  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  throw new Error('No user message found in messages array');
}

// Build advanced system prompt for task breakdown
function buildIssueBreakdownSystemPrompt(): string {
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

// Parse issue breakdown response from LLM
function parseIssueBreakdownResponse(response: string, _userPrompt: string): IssueMasterResult {
  try {
    // Log the full response for debugging
    logger.debug(`Response from LLM (first 500 chars): ${response.slice(0, 500)}...`);

    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      logger.error('No JSON pattern found in response, raw response:', response);
      throw new Error('No valid JSON found in LLM response');
    }

    let jsonStr = jsonMatch[0];
    logger.debug(`Extracted JSON string (first 200 chars): ${jsonStr.slice(0, 200)}...`);

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
          logger.error('JSON after fix attempts (first 300 chars):', jsonStr.slice(0, 300));
          throw new Error(`Failed to parse JSON after fix attempts: ${jsonError.message}`);
        }
      } else {
        // If not a truncation error, rethrow original error
        throw jsonError;
      }
    }

    // Check if we have the expected structure
    if (!taskData || typeof taskData !== 'object') {
      logger.error('Parsed data is not an object:', taskData);
      throw new Error('Invalid JSON structure: not an object');
    }

    if (!taskData.tasks && !Array.isArray(taskData.tasks)) {
      logger.warn('No tasks array found in JSON, looking for fallback structures');

      // Try to use issues array if tasks array is missing
      if (Array.isArray(taskData.issues)) {
        logger.info('Using "issues" array instead of "tasks"');
        taskData.tasks = taskData.issues;
      } else if (Array.isArray(taskData.items)) {
        logger.info('Using "items" array instead of "tasks"');
        taskData.tasks = taskData.items;
      } else {
        // If no array is found, create an empty array
        logger.warn('No suitable task array found, using empty array');
        taskData.tasks = [];
      }
    }

    // Validate and transform the response to match IssueMasterResult format
    const issues: IssueMasterTask[] = (taskData.tasks || []).map((task: any, index: number) => ({
      id: task.id?.toString() || (index + 1).toString(),
      title: task.title || 'Untitled Task',
      description: task.description || '',
      details: task.details || '',
      testStrategy: task.testStrategy || '',
      priority: ['high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium',
      dependencies: Array.isArray(task.dependencies) ? task.dependencies.map((dep: any) => dep.toString()) : [],
    }));

    return {
      summary: taskData.summary || `Issue breakdown completed: ${issues.length} issues`,
      issues,
      totalIssues: issues.length,
      generatedAt: new Date().toISOString(),
      metadata: {
        projectName: taskData.metadata?.projectName || 'User Requirements Project',
        sourceFile: taskData.metadata?.sourceFile || 'API Request',
        totalIssues: issues.length,
      },
    };
  } catch (error: any) {
    logger.error('Failed to parse issue breakdown response:', error);

    // Since we removed the fallback, just throw the error
    throw new Error(`Failed to parse LLM response: ${error.message}`);
  }
}

// Execute issue breakdown using generateText with MCP tools
async function executeEnhancedIssueBreakdown(
  userPrompt: string,
  env: any,
  cookieHeader: string | null,
  userAccessToken?: string,
  files?: FileMap,
  messages?: IssueMessage[],
): Promise<IssueMasterResult> {
  try {
    logger.info('Starting enhanced issue breakdown execution');

    // Setup MCP tools from cookie
    const mcpConfig = getMCPConfigFromCookie(cookieHeader);
    const mcpToolset = await createToolSet(mcpConfig, userAccessToken);
    const mcpTools = mcpToolset.tools;
    logger.info(`MCP tools count: ${Object.keys(mcpTools).length}`);

    // Build messages for task breakdown
    const systemPrompt = buildIssueBreakdownSystemPrompt();
    const userMessage = `Please break down the following requirements into specific development issues:\n\n${userPrompt}`;

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

    // Extract model and provider from the last user message
    let providerName = 'Google';
    let modelName = 'gemini-2.5-pro-preview-05-06';

    if (messages && messages.length > 0) {
      // Find the last user message
      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');

      if (lastUserMessage) {
        const { model, provider } = extractPropertiesFromMessage(lastUserMessage);

        if (model && provider) {
          modelName = model === 'auto' ? FIXED_MODELS.DEFAULT_MODEL.model : model;
          providerName = model === 'auto' ? FIXED_MODELS.DEFAULT_MODEL.provider.name : provider;
          logger.info(`Using model: ${modelName}, provider: ${providerName}`);
        }
      }
    }

    // Get provider instance
    const provider = PROVIDER_LIST.find((p) => p.name === providerName) || DEFAULT_PROVIDER;
    logger.debug(`Selected provider: ${provider.name}`);

    const staticModels = LLMManager.getInstance().getStaticModelListFromProvider(provider);
    let modelDetails = staticModels.find((m: any) => m.name === modelName);

    let modelInstance;

    try {
      if (!modelDetails) {
        logger.warn(`Model ${modelName} not found in static models for provider ${provider.name}`);

        const modelsList = [
          ...(provider.staticModels || []),
          ...(await LLMManager.getInstance().getModelListFromProvider(provider, {
            serverEnv: env,
          })),
        ];

        if (!modelsList.length) {
          logger.error(`No models found for provider ${provider.name}`);
          throw new Error(`No models found for provider ${provider.name}`);
        }

        modelDetails = modelsList.find((m: any) => m.name === modelName);

        if (!modelDetails) {
          logger.warn(
            `MODEL [${modelName}] not found in provider [${provider.name}]. Falling back to first model: ${modelsList[0].name}`,
          );
          modelDetails = modelsList[0];
          modelName = modelDetails.name;
        }
      }

      modelInstance = provider.getModelInstance({
        model: modelName,
        serverEnv: env,
      });

      logger.debug(`Successfully created model instance: ${modelName} from provider: ${provider.name}`);
    } catch (error: any) {
      logger.error(`Failed to create model instance for ${provider.name}/${modelName}: ${error.message}`);

      logger.info('Falling back to default model and provider');

      try {
        const defaultProvider = DEFAULT_PROVIDER;
        const defaultModel = FIXED_MODELS.DEFAULT_MODEL.model;

        modelInstance = defaultProvider.getModelInstance({
          model: defaultModel,
          serverEnv: env,
        });

        logger.info(
          `Successfully created default model instance: ${defaultModel} from provider: ${defaultProvider.name}`,
        );
      } catch (fallbackError: any) {
        logger.error(`Failed to create default model instance: ${fallbackError.message}`);
        throw new Error(`All fallback attempts failed. Cannot create any model instance.`);
      }
    }

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

    logger.info(`combinedTools length: ${Object.keys(combinedTools).length}`);

    // Add file search tools if files are provided
    if (files) {
      logger.info('Adding file search tools to issue breakdown');

      const fileSearchTools = createFileSearchTools(files);
      combinedTools = {
        ...combinedTools,
        ...fileSearchTools,
      };
    }

    logger.info(`combinedTools after file search tools length: ${Object.keys(combinedTools).length}`);

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
      logger.info('Adding project context to issue breakdown');

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
    const combinedMessages = [...systemMessages, ...userMessages];

    logger.info('🔄 Calling generateText with tools and project context...');

    // Setup generateText parameters with tools
    const generateParams: any = {
      model: modelInstance,
      messages: combinedMessages,
      temperature: 0.3,
    };

    // Only add tools if we have them
    if (Object.keys(combinedTools).length > 0) {
      logger.info(`Adding ${Object.keys(combinedTools).length} tools to request`);
      generateParams.tools = combinedTools;
      generateParams.toolChoice = 'auto';
      generateParams.maxSteps = 10;
    }

    // Use LLM call with tools
    const result = await streamText(generateParams);

    let allText = '';

    for await (const part of result.fullStream) {
      logger.info('stream part:', JSON.stringify(part));

      if (part.type === 'text-delta' && part.textDelta) {
        allText += part.textDelta;
      }
    }

    logger.info('allText:', allText);

    const issueBreakdown = parseIssueBreakdownResponse(allText, userPrompt);
    logger.info(`✨ Issue breakdown completed: ${issueBreakdown.issues.length} issues`);

    return issueBreakdown;
  } catch (error: any) {
    logger.error('Enhanced issue breakdown execution failed:', error);
    throw new Error(`Issue breakdown failed: ${error.message}`);
  }
}

// Create conversation response with history
function createConversationResponse(
  messages: IssueMessage[],
  issueBreakdown: IssueMasterResult,
  gitlabResult?: {
    project: GitlabProject;
    issues: GitlabIssue[];
    projectPath: string;
  },
  env?: any,
) {
  const conversationId = generateId();
  const assistantMessage = {
    id: generateId(),
    role: 'assistant' as const,
    content: `I've broken down your requirements into ${issueBreakdown.issues.length} specific issues${gitlabResult ? ` and created corresponding issues in GitLab project ${gitlabResult.projectPath}` : ''}.`,
  };

  return {
    success: true,
    data: {
      // Task breakdown data
      summary: issueBreakdown.summary,
      issues: issueBreakdown.issues,
      totalIssues: issueBreakdown.totalIssues,
      generatedAt: issueBreakdown.generatedAt,
      originalPrompt: extractUserPrompt(messages),
      metadata: issueBreakdown.metadata,

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

// Format issue description for GitLab issue
function formatIssueDescription(issue: IssueMasterTask, issueIdMap?: Map<string, number>): string {
  let description = issue.description;

  if (issue.details) {
    description += `\n\n**Implementation Details:**\n${issue.details}`;
  }

  if (issue.testStrategy) {
    description += `\n\n**Test Strategy:**\n${issue.testStrategy}`;
  }

  if (issue.dependencies && issue.dependencies.length > 0) {
    description += `\n\n**Dependent Issues:**`;

    issue.dependencies.forEach((depId) => {
      if (issueIdMap?.has(depId)) {
        const issueNumber = issueIdMap.get(depId);
        description += `\n- Issue #${issueNumber}`;
      } else {
        description += `\n- Issue ${depId}`;
      }
    });
  }

  return description;
}

// Create GitLab issues from breakdown tasks
async function createGitlabIssuesFromTasks(
  gitlabService: GitlabService,
  projectPath: string,
  issues: IssueMasterTask[],
): Promise<{
  issues: GitlabIssue[];
  errors: Array<{ issue: IssueMasterTask; error: string }>;
  issueIdMap: Map<string, number>;
}> {
  const gitlabIssues: GitlabIssue[] = [];
  const errors: Array<{ issue: IssueMasterTask; error: string }> = [];
  const issueIdMap = new Map<string, number>();

  // Phase 1: Create issues without dependency links
  logger.info(`Creating ${issues.length} GitLab issues...`);

  for (const issue of issues) {
    try {
      logger.debug(`Creating GitLab issue for task: ${issue.title}`);

      const gitlabIssue = await gitlabService.createIssue(
        projectPath,
        issue.title,
        formatIssueDescription(issue), // First pass without dependency links
        {
          labels: ['TODO'],
        },
      );

      gitlabIssues.push(gitlabIssue);
      issueIdMap.set(issue.id, gitlabIssue.iid);
      logger.info(`Created GitLab issue successfully #${gitlabIssue.iid}: ${issue.title}`);
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      errors.push({ issue, error: errorMessage });
      logger.error(`Failed to create GitLab issue for "${issue.title}": ${errorMessage}`);
    }
  }

  // Phase 2: Update issues with proper dependency links
  logger.info('Updating issues with dependency links...');

  for (const issue of issues) {
    if (issue.dependencies && issue.dependencies.length > 0 && issueIdMap.has(issue.id)) {
      try {
        const issueIid = issueIdMap.get(issue.id)!;
        const updatedDescription = formatIssueDescription(issue, issueIdMap);

        await gitlabService.updateIssue(projectPath, issueIid, {
          description: updatedDescription,
        });

        logger.debug(`Updated issue #${issueIid} with dependency links`);
      } catch (error: any) {
        logger.warn(`Failed to update dependency links for issue #${issueIdMap.get(issue.id)}: ${error.message}`);
      }
    }
  }

  return { issues: gitlabIssues, errors, issueIdMap };
}

async function issueAction({ context, request }: ActionFunctionArgs) {
  try {
    const body = await request.json<IssueBreakdownRequest>();
    const { messages, createGitlabIssues, projectName: requestProjectName, existingProjectPath, files } = body;

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
    logger.info(`Issue breakdown request: ${userPrompt.slice(0, 100)}...`);

    const env = { ...context.cloudflare.env, ...process.env } as Env;
    logger.debug(
      `Environment variables: GOOGLE_GENERATIVE_AI_API_KEY exists: ${!!env.GOOGLE_GENERATIVE_AI_API_KEY}, length: ${env.GOOGLE_GENERATIVE_AI_API_KEY?.length || 0}`,
    );

    const user = context?.user as { email: string; isActivated: boolean };
    const cookieHeader = request.headers.get('Cookie');

    // Step 1: Execute enhanced issue breakdown using our own implementation
    const issueBreakdown = await executeEnhancedIssueBreakdown(
      userPrompt,
      env,
      cookieHeader,
      (context.user as ContextUser)?.accessToken,
      files,
      messages,
    );
    logger.info(`Issue breakdown completed, generated ${issueBreakdown.issues.length} issues`);

    const gitlabService = new GitlabService(env as any);
    const gitlabUser = await gitlabService.getOrCreateUser(user.email);
    logger.info(`GitLab user: ${gitlabUser.username}`);

    const [username, projectName] = existingProjectPath?.split('/') || [];
    const project = await gitlabService.findProject(username, projectName);
    logger.info(`Found existing project: ${project.path_with_namespace}`);

    const branch = 'issue';

    let projectPath = existingProjectPath;

    if (!projectPath) {
      const projectName = requestProjectName || generateProjectName(userPrompt);
      projectPath = `${gitlabUser.username}/${projectName}`;
    }

    // Check if branch exists
    let branchExists = false;

    try {
      await gitlabService.gitlab.Branches.show(project.id, branch);
      branchExists = true;
    } catch {
      branchExists = false;
    }

    if (!branchExists) {
      await gitlabService.gitlab.Branches.create(project.id, branch, 'main');
    }

    // Step 2: GitLab integration (if requested)
    if (createGitlabIssues) {
      try {
        logger.info('Starting GitLab integration...');

        // Create GitLab issues from breakdown tasks
        const issueResults = await createGitlabIssuesFromTasks(
          gitlabService,
          project.path_with_namespace,
          issueBreakdown.issues,
        );
        logger.info(`Created ${issueResults.issues.length} GitLab issues, ${issueResults.errors.length} errors`);

        const gitlabResult = {
          project,
          issues: issueResults.issues,
          projectPath: project.path_with_namespace,
          issueIdMap: Object.fromEntries(issueResults.issueIdMap),
        };

        const branch = 'issue';
        const responseData = createConversationResponse(messages, issueBreakdown, gitlabResult, env);

        const lastUserMsg =
          messages
            .slice()
            .reverse()
            .find((m) => m.role === 'user')?.content || '';

        const purePrompt = lastUserMsg
          .split('\n')
          .filter((line) => !/^\[.*?\]/.test(line.trim()))
          .join(' ')
          .trim();

        const commitTitle = purePrompt.slice(0, 40).replace(/\n/g, '');

        const commitMsg = `${commitTitle}\n\n<V8Metadata>${JSON.stringify({ Branch: branch })}</V8Metadata>\n<V8UserMessage>\n${userPrompt}\n</V8UserMessage>\n<V8AssistantMessage>\n${responseData.data?.messages?.at(-1)?.content || 'update: issue breakdown'}\n</V8AssistantMessage>\n`;
        const fileName = `issue-history/issue-${Date.now()}.json`;
        const filesToCommit = [
          {
            path: fileName,
            content: JSON.stringify(
              {
                timestamp: new Date().toISOString(),
                userPrompt,
                messages,
                issueBreakdown,
              },
              null,
              2,
            ),
          },
        ];

        try {
          await gitlabService.commitFiles(project.id, filesToCommit, commitMsg, branch);
          logger.info(`Committed issue breakdown to GitLab branch ${branch} as ${fileName}`);
        } catch (e: any) {
          logger.warn('Failed to commit issue breakdown to GitLab branch: ' + (e?.message || e));
        }

        // Return response
        return Response.json(responseData);
      } catch (gitlabError: any) {
        logger.error('GitLab integration failed:', gitlabError);

        // Return task breakdown even if GitLab fails
        return Response.json(createConversationResponse(messages, issueBreakdown, undefined, env));
      }
    }

    // Return task breakdown without GitLab integration
    return Response.json(createConversationResponse(messages, issueBreakdown, undefined, env));
  } catch (error: any) {
    logger.error('Issue breakdown failed:', error);
    return Response.json(
      {
        success: false,
        error: error.message || 'Issue breakdown failed',
      },
      { status: 500 },
    );
  }
}
