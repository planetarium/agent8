import { atom } from 'nanostores';
import { type V8User } from '~/lib/verse8/userAuth';

export const v8UserStore = atom<{ loading: boolean; user: V8User | null }>({
  loading: false,
  user: null,
});
