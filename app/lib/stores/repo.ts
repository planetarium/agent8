import { map } from 'nanostores';

export const DEFAULT_TASK_BRANCH = 'develop';

export const repoStore = map({
  name: '',
  path: '',
  title: '',
  taskBranch: DEFAULT_TASK_BRANCH,
});
