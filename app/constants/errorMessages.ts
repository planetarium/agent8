export const ERROR_MESSAGES = {
  NETWORK: {
    NETWORK_ERROR: 'network error',
  },
} as const;

export type NetworkErrorMessage = (typeof ERROR_MESSAGES.NETWORK)[keyof typeof ERROR_MESSAGES.NETWORK];
