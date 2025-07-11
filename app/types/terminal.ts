import type { IDisposable } from '@xterm/xterm';

export type { IDisposable };

export interface ITerminal {
  readonly cols?: number;
  readonly rows?: number;

  reset: () => void;
  write: (data: string) => void;
  onData: (cb: (data: string) => void) => IDisposable;
  input: (data: string) => void;
}
