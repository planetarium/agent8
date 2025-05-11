import { map } from 'nanostores';

export const toolUIStore = map<{
  tools: Record<string, any>;
}>({
  tools: {},
});
