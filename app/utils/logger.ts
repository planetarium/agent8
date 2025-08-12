export type DebugLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
import { Chalk } from 'chalk';

const chalk = new Chalk({ level: 3 });

type LoggerFunction = (...messages: any[]) => void;

interface Logger {
  trace: LoggerFunction;
  debug: LoggerFunction;
  info: LoggerFunction;
  warn: LoggerFunction;
  error: LoggerFunction;
  setLevel: (level: DebugLevel) => void;
}

let currentLevel: DebugLevel = (import.meta.env.VITE_LOG_LEVEL ?? import.meta.env.DEV) ? 'debug' : 'info';

export const logger: Logger = {
  trace: (...messages: any[]) => log('trace', undefined, messages),
  debug: (...messages: any[]) => log('debug', undefined, messages),
  info: (...messages: any[]) => log('info', undefined, messages),
  warn: (...messages: any[]) => log('warn', undefined, messages),
  error: (...messages: any[]) => log('error', undefined, messages),
  setLevel,
};

export function createScopedLogger(scope: string): Logger {
  return {
    trace: (...messages: any[]) => log('trace', scope, messages),
    debug: (...messages: any[]) => log('debug', scope, messages),
    info: (...messages: any[]) => log('info', scope, messages),
    warn: (...messages: any[]) => log('warn', scope, messages),
    error: (...messages: any[]) => log('error', scope, messages),
    setLevel,
  };
}

function setLevel(level: DebugLevel) {
  if ((level === 'trace' || level === 'debug') && import.meta.env.PROD) {
    return;
  }

  currentLevel = level;
}

function formatTime(): string {
  const now = new Date();
  return now.toTimeString().split(' ')[0] + '.' + now.getMilliseconds().toString().padStart(3, '0');
}

function log(level: DebugLevel, scope: string | undefined, messages: any[]) {
  const levelOrder: DebugLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];

  if (levelOrder.indexOf(level) < levelOrder.indexOf(currentLevel)) {
    return;
  }

  const allMessages = messages.reduce((acc, cur) => (acc ? `${acc} ${cur}` : `${cur}`), '');

  const labelBg = getColorForLevel(level);
  const labelFg = level === 'warn' ? '#000000' : '#FFFFFF';

  const timeStyles = getLabelStyles('#555555', '#FFFFFF');
  const labelStyles = getLabelStyles(labelBg, labelFg);
  const scopeStyles = getLabelStyles('#77828D', '#FFFFFF');

  const time = formatTime();
  const hasScope = typeof scope === 'string' && scope.length > 0;

  if (typeof window !== 'undefined') {
    const fmt = hasScope ? `%c${time}%c ${level.toUpperCase()}%c ${scope}%c` : `%c${time}%c ${level.toUpperCase()}%c`;

    const args = hasScope ? [timeStyles, labelStyles, scopeStyles, ''] : [timeStyles, labelStyles, ''];

    console.log(fmt, ...args, allMessages);
  } else {
    const timeLabel = formatText(` ${time} `, '#FFFFFF', '#555555');
    let labelText = formatText(` ${level.toUpperCase()} `, labelFg, labelBg);

    if (hasScope) {
      labelText += ` ${formatText(` ${scope} `, '#FFFFFF', '#77828D')}`;
    }

    console.log(`${timeLabel} ${labelText}`, allMessages);
  }
}

function formatText(text: string, color: string, bg: string) {
  return chalk.bgHex(bg)(chalk.hex(color)(text));
}

function getLabelStyles(color: string, textColor: string) {
  return `background-color: ${color}; color: white; border: 4px solid ${color}; color: ${textColor};`;
}

function getColorForLevel(level: DebugLevel): string {
  switch (level) {
    case 'trace':
    case 'debug': {
      return '#77828D';
    }
    case 'info': {
      return '#1389FD';
    }
    case 'warn': {
      return '#FFDB6C';
    }
    case 'error': {
      return '#EE4744';
    }
    default: {
      return '#000000';
    }
  }
}

export const renderLogger = createScopedLogger('Render');
