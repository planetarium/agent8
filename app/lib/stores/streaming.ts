import { atom } from 'nanostores';

export const streamingState = atom<boolean>(false);

// Flag to indicate sound should play when preview becomes ready (after streaming completes)
export const shouldPlaySoundOnPreviewReady = atom<boolean>(false);
