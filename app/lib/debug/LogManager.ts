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
   * Get all logs (readonly)
   */
  get logs(): readonly string[] {
    return this._logs;
  }

  /**
   * Add a log to the log manager
   * @param location - The location of the log
   */
  add(location: string): void {
    this._logs.push(location);
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this._logs = [];
  }
}

export const logManager = LogManager.getInstance();
