class LogManager {
  private static _instance: LogManager;
  private _logs: string[] = [];

  static getInstance(): LogManager {
    if (!LogManager._instance) {
      LogManager._instance = new LogManager();
    }

    return LogManager._instance;
  }

  /**
   * Add a log to the log manager
   * @param location - The location of the log
   */
  add(location: string): void {
    this._logs.push(location);
  }

  /**
   * Get all logs
   * @returns All logs
   */
  get(): string[] {
    return [...this._logs];
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this._logs = [];
  }
}

export const logManager = LogManager.getInstance();

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__logManager = logManager;
  console.log('LogManager available at window.__logManager');
}
