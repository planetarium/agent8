import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createClient } from '@supabase/supabase-js';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const url = new URL(request.url);
  const tags = url.searchParams.get('tags')?.split(',').filter(Boolean) || [];
  const keyword = url.searchParams.get('keyword') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '10');
  const offset = (page - 1) * limit;

  try {
    let query = supabase.from('resources').select('id, description, url, metadata', { count: 'exact' });

    // Tag filtering
    if (tags.length > 0) {
      const tagsJsonb = JSON.stringify(tags);
      query = query.filter('metadata->tags', 'cs', tagsJsonb);
    }

    // Keyword filtering
    if (keyword) {
      query = query.ilike('description', `%${keyword}%`);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    const totalPages = Math.ceil((count || 0) / limit);

    return json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error: any) {
    console.error('Resources search error:', error);
    return json({
      success: false,
      error: error.message,
      data: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    });
  }
}
