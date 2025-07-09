export default class Notifications {
  constructor(containerId = 'notifications') {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = containerId;
      this.container.style.position = 'fixed';
      this.container.style.top = '1rem';
      this.container.style.right = '1rem';
      this.container.style.zIndex = '9999';
      this.container.style.display = 'flex';
      this.container.style.flexDirection = 'column';
      this.container.style.gap = '0.5rem';
      document.body.appendChild(this.container);
    }
  }

  show(message, type = 'info', duration = 3000) {
    const el = document.createElement('div');
    el.textContent = message;
    el.className = `notification ${type}`;
    el.style.padding = '0.75rem 1rem';
    el.style.borderRadius = '0.5rem';
    el.style.fontSize = '0.9rem';
    el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.1)';
    el.style.color = '#fff';
    el.style.backgroundColor = this.getBgColor(type);
    el.style.opacity = '0.95';
    el.style.transition = 'opacity 0.5s';

    this.container.appendChild(el);

    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => {
        this.container.removeChild(el);
      }, 500);
    }, duration);
  }

  getBgColor(type) {
    switch (type) {
      case 'success':
        return '#38a169'; // green
      case 'error':
        return '#e53e3e'; // red
      case 'warning':
        return '#dd6b20'; // orange
      default:
        return '#3182ce'; // blue
    }
  }
}