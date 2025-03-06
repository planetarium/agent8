import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { embed } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { createOpenAI } from '@ai-sdk/openai';

export async function action({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const supabase = createClient(
    env.SUPABASE_URL || process.env.SUPABASE_URL!,
    env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const openai = createOpenAI({
    apiKey: env.OPENAI_API_KEY || process?.env?.OPENAI_API_KEY,
  });
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'insert') {
    const clientCode = formData.get('clientCode') as string;
    const serverCode = formData.get('serverCode') as string;
    const description = formData.get('description') as string;
    const category = (formData.get('category') as string) || 'code';

    if (!clientCode && !serverCode) {
      return json({ success: false });
    }

    try {
      const { embedding } = await embed({
        model: openai.embedding('text-embedding-ada-002'),
        value: description,
      });

      // 데이터 삽입
      const { error } = await supabase.from('codebase').insert({
        description,
        client_code: clientCode,
        server_code: serverCode,
        metadata: {
          category,
        },
        embedding,
      });

      if (error) {
        throw error;
      }

      return json({ success: true });
    } catch (error: any) {
      return json({ success: false, error: error.message });
    }
  } else if (intent === 'delete') {
    const id = formData.get('id') as string;

    if (!id) {
      return json({ success: false, error: 'ID is required' });
    }

    try {
      const { error } = await supabase.from('codebase').delete().eq('id', id);

      if (error) {
        throw error;
      }

      return json({ success: true });
    } catch (error: any) {
      return json({ success: false, error: error.message });
    }
  }

  return json({ success: false, error: 'Invalid intent' });
}
