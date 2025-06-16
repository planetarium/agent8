import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { default as TaskBoardRoute } from './taskboard';

export async function loader(args: LoaderFunctionArgs) {
  return json({ id: args.params.id });
}

export default TaskBoardRoute;
