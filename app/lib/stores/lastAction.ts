import { map } from 'nanostores';

export const lastActionStore = map<{
  action: 'SEND_MESSAGE' | 'LOAD' | 'INIT';
}>({
  action: 'INIT',
});
