import Logger from './Logger.js';

export default class StatusMonitor {
  constructor(displayElId = 'status') {
    this.statusEl = document.getElementById(displayElId);
    this.statusMap = new Map(); // key -> value
  }

  update(key, value, silent = false) {
    this.statusMap.set(key, value);
    if (!silent) {
      Logger.info(`[StatusMonitor] ${key} =`, value);
    }
    this.render();
  }

  bulkUpdate(obj = {}) {
    Object.entries(obj).forEach(([key, value]) => this.update(key, value, true));
    this.render();
  }

  remove(key) {
    this.statusMap.delete(key);
    this.render();
  }

  clear() {
    this.statusMap.clear();
    this.render();
  }

  render() {
    if (!this.statusEl) return;
    const content = Array.from(this.statusMap.entries())
      .map(([key, val]) => `${key}: ${typeof val === 'object' ? JSON.stringify(val) : val}`)
      .join('\n');
    this.statusEl.textContent = content;
  }

  getStatus() {
    return Object.fromEntries(this.statusMap.entries());
  }

  logToConsole() {
    Logger.debug('[StatusMonitor Snapshot]', this.getStatus());
  }
}