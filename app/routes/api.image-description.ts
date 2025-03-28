import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import { PROVIDER_LIST } from '~/utils/constants';

export async function action(args: ActionFunctionArgs) {
  return imageDescriptionAction(args);
}

export async function generateImageDescription(
  imageUrls: string[],
): Promise<{ imageUrl: string; features: string; details: string }[]> {
  const provider = PROVIDER_LIST.find((p) => p.name === 'OpenRouter');
  const model = 'google/gemini-2.0-flash-lite-001';

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
      }),
      system: `You are an image analysis expert in the gaming industry. 
      You describe images in a way that other LLMs can accurately infer their characteristics and forms. 
      You also recommend how the image could be utilized in various games with appropriate examples. 
      Please analyze the images listed below. 
      For each image, create both "details" and "features". 
      The "details" should be between 100 and 500 characters, describing the image thoroughly enough that an LLM could recreate it as accurately as possible. 
      The "features" should be between 30 and 80 characters, highlighting the characteristics and appropriate use cases that would help an LLM utilize this image when creating games. 
      Please follow this response format: 
      
      [{"imageUrl": "", "details": "", "features": ""}]
      
      CRITICAL: Do not return any text other than JSON.
      `,
      maxTokens: 8000,
      messages: [
        {
          role: 'user',
          content: imageUrls.map((imageUrl) => ({
            type: 'image',
            image: imageUrl,
          })),
        },
      ],
    });

    const jsonMatch = resp.text.match(/\[.*\]/s);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {}

  return [];
}

async function imageDescriptionAction({ request }: ActionFunctionArgs) {
  const { imageUrls } = await request.json<{
    imageUrls: string[];
  }>();

  try {
    const result = await generateImageDescription(imageUrls);

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
