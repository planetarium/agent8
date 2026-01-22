import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateObject } from 'ai';
import { STARTER_TEMPLATES, FIXED_MODELS } from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';
import { withV8AuthUser, type ContextConsumeUserCredit } from '~/lib/verse8/middleware';
import { withTurnstile } from '~/lib/turnstile/middleware';
import { TEMPLATE_SELECTION_SCHEMA } from '~/utils/selectStarterTemplate';
import type { TemplateSelectionResponse, Template } from '~/types/template';
import { isAbortError, isApiKeyError } from '~/utils/errors';
import { smartTry } from '~/utils/promises';

export const action = withTurnstile(withV8AuthUser(startcallAction, { checkCredit: true }));

const logger = createScopedLogger('api.startcall');

const MAX_RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

const starterTemplateSelectionPrompt = (templates: Template[]) => `
You are an experienced developer who helps people choose the best starter template for their projects.

Available templates:
${templates
  .map(
    (template) => `
<template>
  <name>${template.name}</name>
  <label>${template.label}</label>
  <description>${template.description}</description>
  ${template.tags ? `<tags>${template.tags.join(', ')}</tags>` : ''}
</template>
`,
  )
  .join('\n')}

Instructions:
1. For trivial tasks and simple scripts, always recommend the basic-vite-react template
2. For more complex projects, recommend templates from the provided list
3. Consider both technical requirements and tags
4. If no perfect match exists, recommend the closest option

nextActionSuggestion guidelines:
1. It's unacceptable for a project build to fail due to simple changes or code modifications. Please request the simplest next task.
2. The requested task should not cause the program build to fail once the unit task is completed.
3. To handle the first requested task, it is appropriate to have work at the level of modifying about one file.
4. Think of it as a work unit when developing rather than an implementation unit in the game.

Examples of good nextActionSuggestion:
- GOOD: Changing the texture of the map specifically
- GOOD: Placing trees on the map
- BAD: Setting the surrounding environment of the 3d map (This can involve many tasks.)

Selection examples:

User: I need to build a 2d platformer game
Expected response:
{
  "templateName": "basic-2d",
  "title": "Simple 2d platformer game",
  "projectRepo": "basic-2d-game",
  "nextActionSuggestion": "Please change background image."
}

User: Make a simple 3d rpg game
Expected response:
{
  "templateName": "basic-3d-quarterview",
  "title": "Simple 3d rpg game",
  "projectRepo": "basic-3d-rpg-game",
  "nextActionSuggestion": "Add a floor texture and skybox."
}

Return your selection as a JSON object with these exact fields:
- templateName: the selected template name (string)
- title: a proper title for the project (string)
- projectRepo: the name of the new project repository (string)
- nextActionSuggestion: suggestions for the next action (string, empty if none)

Important: Return ONLY the JSON object, no additional text or explanation.
MOST IMPORTANT: YOU DONT HAVE TIME TO THINK JUST START RESPONDING BASED ON HUNCH
`;

async function startcallAction({ context, request }: ActionFunctionArgs) {
  const env = { ...process.env, ...context.cloudflare?.env } as Env;
  const { message } = await request.json<{
    message: string;
  }>();

  let templates: Template[] = STARTER_TEMPLATES;

  try {
    const branch = env.VITE_USE_PRODUCTION_TEMPLATE === 'true' ? 'production' : 'main';
    const response = await fetch(
      `https://raw.githubusercontent.com/planetarium/agent8-templates/${branch}/templates.json`,
      { signal: request.signal },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch templates from GitHub`);
    }

    templates = (await response.json()) as Template[];
  } catch {
    logger.info('Failed to fetch templates, using local fallback');
    templates = STARTER_TEMPLATES;
  }

  try {
    // track which provider/model was used for credit consumption
    let usedProvider = FIXED_MODELS.SELECT_STARTER_TEMPLATES[0].provider;
    let usedModel = FIXED_MODELS.SELECT_STARTER_TEMPLATES[0].model;

    const result = await smartTry(
      async (attempt) => {
        const modelIndex = attempt % FIXED_MODELS.SELECT_STARTER_TEMPLATES.length;

        // select model based on attempt number
        const { provider: currentProvider, model: currentModel } = FIXED_MODELS.SELECT_STARTER_TEMPLATES[modelIndex];

        usedProvider = currentProvider;
        usedModel = currentModel;

        logger.info(`Attempt ${attempt + 1}: Using ${currentProvider.name} - ${currentModel}`);

        try {
          const result = await generateObject({
            model: currentProvider.getModelInstance({
              model: currentModel,
              serverEnv: env,
            }),
            schema: TEMPLATE_SELECTION_SCHEMA,
            messages: [
              {
                role: 'system',
                content: starterTemplateSelectionPrompt(templates),
                providerOptions: {
                  anthropic: {
                    cacheControl: { type: 'ephemeral' },
                  },
                },
              },
              {
                role: 'user',
                content: `${message}`,
              },
            ],
            abortSignal: request.signal,
          });

          // schema validation check
          const selection = result.object;
          const validationResult = TEMPLATE_SELECTION_SCHEMA.safeParse(selection);

          if (!validationResult.success) {
            const errorDetails = validationResult.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join(', ');

            throw new Error(`Template selection validation failed: ${errorDetails}`);
          }

          return result;
        } catch (error) {
          // Log error before retry decision
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(`Attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS} failed: ${errorMessage}`);
          throw error;
        }
      },
      {
        maxRetries: MAX_RETRY_ATTEMPTS,
        delayMs: RETRY_DELAY_MS,
        shouldRetry: (error) => {
          return !isAbortError(error) && !isApiKeyError(error);
        },
      },
    );

    // On success, handle usage (consume user credit)
    if (result.usage) {
      let cacheRead = 0;
      let cacheWrite = 0;

      if (result.providerMetadata?.anthropic) {
        const { cacheCreationInputTokens, cacheReadInputTokens } = result.providerMetadata.anthropic;
        cacheRead += Number(cacheReadInputTokens || 0);
        cacheWrite += Number(cacheCreationInputTokens || 0);
      }

      const consumeUserCredit = context.consumeUserCredit as ContextConsumeUserCredit;
      await consumeUserCredit({
        model: { provider: usedProvider.name, name: usedModel },
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheRead,
        cacheWrite,
        description: 'Start Call',
      });
    }

    const selection = result.object;

    const selectedTemplate = templates.find((t) => t.name === selection.templateName);
    const response: TemplateSelectionResponse = {
      templateName: selection.templateName,
      title: selection.title,
      projectRepo: selection.projectRepo,
      nextActionSuggestion: selection.nextActionSuggestion,
      template: selectedTemplate,
    };

    return Response.json(response);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Response('Aborted', {
        status: 499,
        statusText: 'Client Closed Request',
      });
    }

    if (isApiKeyError(error)) {
      throw new Response('Invalid or missing API key', {
        status: 401,
        statusText: 'Unauthorized',
      });
    }

    logger.error('All retry attempts failed', error);

    // Include the actual error message in the body
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Response(errorMessage, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
