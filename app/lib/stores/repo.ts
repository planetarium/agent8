import { map } from 'nanostores';

export const repoStore = map({
  name: '',
  path: '',
  title: '',
  latestCommitHash: '',
});
