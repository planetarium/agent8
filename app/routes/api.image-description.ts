import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText, type LanguageModelUsage } from 'ai';
import { FIXED_MODELS } from '~/utils/constants';
import { withV8AuthUser, type ContextConsumeUserCredit } from '~/lib/verse8/middleware';
import { withTurnstile } from '~/lib/turnstile/middleware';

export const action = withTurnstile(withV8AuthUser(imageDescriptionAction, { checkCredit: true }));

export async function generateImageDescription(
  imageUrls: string[],
  message: string,
  env: Env,
  onFinish: (args: { usage: LanguageModelUsage; model: string; provider: string }) => void,
): Promise<{ imageUrl: string; features: string; details: string }[]> {
  const provider = FIXED_MODELS.IMAGE_DESCRIPTION.provider;
  const model = FIXED_MODELS.IMAGE_DESCRIPTION.model;

  // Validate inputs
  if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
    throw new Response('Invalid or missing imageUrls', {
      status: 400,
      statusText: 'Bad Request',
    });
  }

  try {
    const resp = await generateText({
      model: provider!.getModelInstance({
        model,
        serverEnv: env,
      }),
      system: `You are an image analysis expert in the gaming industry. 
      You describe images in a way that other LLMs can accurately infer their characteristics and forms. 
      You also recommend how the image could be utilized in various games with appropriate examples. 
      Please analyze the images listed below. 
      For each image, create both "details" and "features". 
      If the image is a sprite sheet, you should output the number of rows and columns. And if it's a character, you need to additionally provide information on whether it's moving upwards, downwards, left, right, or attacking.
      The "details" should be between 100 and 500 characters, describing the image thoroughly enough that an LLM could recreate it as accurately as possible. And you should describe the necessary information according to the user's request. For example, if the user requests information about color schemes, describe the color information, and if they want to follow the arrangement of objects here, describe that in more detail here.
      The "features" should be between 30 and 80 characters, highlighting the characteristics and appropriate use cases that would help an LLM utilize this image when creating games. 

      <UserRequest>
      ${message}
      </UserRequest>

      Please follow this response format: 
      
      [{"imageUrl": "", "details": "", "features": ""}]
      
      CRITICAL: Do not return any text other than JSON.
      `,
      maxOutputTokens: 8000,
      messages: [
        {
          role: 'user',
          content: imageUrls.map((imageUrl) => ({
            type: 'image',
            image: imageUrl,
          })),
        },
      ],
      onStepFinish: (args) => {
        onFinish({
          usage: args.usage,
          model,
          provider: provider!.name,
        });
      },
    });

    const jsonMatch = resp.text.match(/\[.*\]/s);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {}

  return [];
}

async function imageDescriptionAction({ request, context }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const { imageUrls, message } = await request.json<{
    imageUrls: string[];
    message: string;
  }>();

  try {
    const result = await generateImageDescription(imageUrls, message, env, ({ usage, model, provider }) => {
      if (usage) {
        const consumeUserCredit = context.consumeUserCredit as ContextConsumeUserCredit;
        consumeUserCredit({
          model: { provider, name: model },
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          description: 'Image Description',
        });
      }
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error: unknown) {
    console.log(error);

    if (error instanceof Error && error.message?.includes('API key')) {
      throw new Response('Invalid or missing API key', {
        status: 401,
        statusText: 'Unauthorized',
      });
    }

    throw new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
