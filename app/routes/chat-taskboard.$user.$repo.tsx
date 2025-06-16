import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { default as TaskBoardRoute } from './taskboard';

export async function loader(args: LoaderFunctionArgs) {
  const repoPath = args.params.user + '/' + args.params.repo;

  return json({
    id: repoPath,
    repoPath,
    repoUser: args.params.user,
    repoName: args.params.repo,
  });
}

export default TaskBoardRoute;
