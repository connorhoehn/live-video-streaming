export default class Logger {
  static info(...args) {
    console.log(`🟢 [INFO ${Logger.timestamp()}]`, ...args);
  }

  static warn(...args) {
    console.warn(`🟡 [WARN ${Logger.timestamp()}]`, ...args);
  }

  static error(...args) {
    console.error(`🔴 [ERROR ${Logger.timestamp()}]`, ...args);
  }

  static debug(...args) {
    if (Logger.isDebugMode()) {
      console.debug(`🔍 [DEBUG ${Logger.timestamp()}]`, ...args);
    }
  }

  static timestamp() {
    return new Date().toISOString();
  }

  static isDebugMode() {
    return window?.DEBUG === true;
  }
}