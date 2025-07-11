import type { ContainerProcess, ShellSession } from '~/lib/container/interfaces';
import type { Container } from '~/lib/container/interfaces';
import { atom, type WritableAtom } from 'nanostores';
import type { ITerminal } from '~/types/terminal';
import { newBoltShellProcess } from '~/utils/shell';
import { coloredText } from '~/utils/terminal';

export class TerminalStore {
  #container: Promise<Container>;
  #terminals: Array<{ terminal: ITerminal; process: ContainerProcess; session: ShellSession }> = [];
  #boltTerminal = newBoltShellProcess();

  showTerminal: WritableAtom<boolean> = import.meta.hot?.data.showTerminal ?? atom(true);

  constructor(containerPromise: Promise<Container>) {
    this.#container = containerPromise;

    if (import.meta.hot) {
      import.meta.hot.data.showTerminal = this.showTerminal;
    }
  }

  get terminals() {
    return this.#terminals.map(({ terminal }) => terminal);
  }

  get boltTerminal() {
    return this.#boltTerminal;
  }

  toggleTerminal(value?: boolean) {
    this.showTerminal.set(value !== undefined ? value : !this.showTerminal.get());
  }

  async attachBoltTerminal(terminal: ITerminal) {
    try {
      const container = await this.#container;
      await this.#boltTerminal.init(container, terminal);
    } catch (error: any) {
      terminal.write(coloredText.red('Failed to spawn bolt shell\n\n') + error.message);
      return;
    }
  }

  async attachTerminal(terminal: ITerminal) {
    try {
      const container = await this.#container;
      const shellSession = await container.spawnShell(terminal);
      this.#terminals.push({ terminal, process: shellSession.process, session: shellSession });
    } catch (error: any) {
      terminal.write(coloredText.red('Failed to spawn shell\n\n') + error.message);
      return;
    }
  }

  onTerminalResize(cols: number, rows: number) {
    for (const { process } of this.#terminals) {
      process.resize({ cols, rows });
    }
  }

  detachTerminals() {
    for (const { session } of this.#terminals) {
      if (session.detachTerminal) {
        session.detachTerminal();
      }
    }

    this.#boltTerminal.detachTerminal();
  }
}
