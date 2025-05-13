import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react';
import type { Theme } from '~/lib/stores/theme';
import { createScopedLogger } from '~/utils/logger';
import { getTerminalTheme } from './theme';
import { debounce } from '~/utils/debounce';

const logger = createScopedLogger('Terminal');

export interface TerminalRef {
  reloadStyles: () => void;
}

export interface TerminalProps {
  className?: string;
  theme: Theme;
  readonly?: boolean;
  id: string;
  onTerminalReady?: (terminal: XTerm) => void;
  onTerminalResize?: (cols: number, rows: number) => void;
}

export const Terminal = memo(
  forwardRef<TerminalRef, TerminalProps>(
    ({ className, theme, readonly, id, onTerminalReady, onTerminalResize }, ref) => {
      const terminalElementRef = useRef<HTMLDivElement>(null);
      const terminalRef = useRef<XTerm>();
      const lastCheckedLineRef = useRef<number>(0);

      useEffect(() => {
        const element = terminalElementRef.current!;

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        const terminal = new XTerm({
          cursorBlink: true,
          convertEol: true,
          disableStdin: readonly,
          theme: getTerminalTheme(readonly ? { cursor: '#00000000' } : {}),
          fontSize: 12,
          fontFamily: 'Menlo, courier-new, courier, monospace',
        });

        // Debounced error detection function to prevent frequent calls
        const checkForViteErrors = debounce(async () => {
          const { workbenchStore } = await import('~/lib/stores/workbench');

          // Detect Vite errors with specific patterns
          const viteErrorPatterns = [
            /\[vite\].*error:/i,
            /vite:(\w+).*Error:/i,
            /error when evaluating SSR module/i,
            /failed to load module/i,
            /error resolving import/i,
            /failed to resolve import/i,
          ];

          // Get the entire terminal buffer
          const activeBuffer = terminal.buffer.active;
          const recentOutput = [];

          // Check if terminal was cleared (buffer length dramatically decreased)
          if (activeBuffer.length < lastCheckedLineRef.current - 10) {
            // Terminal was likely cleared, reset the checkpoint
            lastCheckedLineRef.current = 0;
          }

          const startLine = lastCheckedLineRef.current;
          const endLine = activeBuffer.length;

          // Skip if there are no new lines to check
          if (startLine >= endLine) {
            return;
          }

          for (let i = startLine; i < endLine; i++) {
            const line = activeBuffer.getLine(i);

            if (line) {
              recentOutput.push(line.translateToString());
            }
          }

          // Update the last checked line index
          lastCheckedLineRef.current = endLine;

          const recentText = recentOutput.join('\n');

          logger.debug(`Check from ${startLine} to ${endLine}`);
          logger.debug(recentOutput.join('\n'));

          if (viteErrorPatterns.some((pattern) => pattern.test(recentText))) {
            logger.debug('Vite error detected');

            workbenchStore.actionAlert.set({
              type: 'vite',
              title: 'Vite Error',
              description: 'An error occurred while running Vite build or dev server',
              content: recentText,
              source: 'terminal',
            });
          } else {
            logger.debug('No Vite error detected');
          }
        }, 1_000);

        const onWriteParsedDisposable = terminal.onWriteParsed(() => {
          checkForViteErrors();
        });

        terminalRef.current = terminal;

        terminal.loadAddon(fitAddon);
        terminal.loadAddon(webLinksAddon);
        terminal.open(element);

        const resizeObserver = new ResizeObserver(() => {
          fitAddon.fit();
          onTerminalResize?.(terminal.cols, terminal.rows);
        });

        resizeObserver.observe(element);

        logger.debug(`Attach [${id}]`);

        onTerminalReady?.(terminal);

        return () => {
          resizeObserver.disconnect();
          terminal.dispose();
          onWriteParsedDisposable.dispose();
        };
      }, []);

      useEffect(() => {
        const terminal = terminalRef.current!;

        // we render a transparent cursor in case the terminal is readonly
        terminal.options.theme = getTerminalTheme(readonly ? { cursor: '#00000000' } : {});

        terminal.options.disableStdin = readonly;
      }, [theme, readonly]);

      useImperativeHandle(ref, () => {
        return {
          reloadStyles: () => {
            const terminal = terminalRef.current!;
            terminal.options.theme = getTerminalTheme(readonly ? { cursor: '#00000000' } : {});
          },
        };
      }, []);

      return <div className={className} ref={terminalElementRef} />;
    },
  ),
);
