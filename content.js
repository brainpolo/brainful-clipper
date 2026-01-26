/**
 * Content script - shows toast notifications on the page
 * Injected into all pages to receive messages from background script
 */

/** @type {string} */
const TOAST_ID = 'brainful-toast';

/** @type {string} */
const STYLES_ID = 'brainful-toast-styles';

/** @type {Record<string, string>} */
const COLORS = {
  success: '#22c55e',
  error: '#ef4444',
  loading: '#3b82f6',
  info: '#3b82f6',
  warning: '#f59e0b',
};

/**
 * Inject animation styles into page head (idempotent)
 */
function injectStyles() {
  if (document.getElementById(STYLES_ID)) return;

  const style = document.createElement('style');
  style.id = STYLES_ID;
  style.textContent = `
    @keyframes brainfulSlideIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes brainfulSlideOut {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(10px); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Show a toast notification on the page
 * @param {string} message - Toast message
 * @param {'info' | 'success' | 'error' | 'loading' | 'warning'} [type='info'] - Toast type
 */
function showToast(message, type = 'info') {
  const existing = document.getElementById(TOAST_ID);
  if (existing) existing.remove();

  injectStyles();

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 14px 20px;
    background: ${COLORS[type] || COLORS.info};
    color: white;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    font-size: 14px;
    font-weight: 500;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    z-index: 2147483647;
    animation: brainfulSlideIn 0.3s ease;
  `;

  document.body.appendChild(toast);

  if (type !== 'loading') {
    setTimeout(() => {
      toast.style.animation = 'brainfulSlideOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

/**
 * Hide the current toast with animation
 */
function hideToast() {
  const toast = document.getElementById(TOAST_ID);
  if (toast) {
    toast.style.animation = 'brainfulSlideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }
}

/**
 * @typedef {Object} ToastMessage
 * @property {'SHOW_TOAST' | 'HIDE_TOAST'} type
 * @property {string} [text]
 * @property {string} [toastType]
 */

chrome.runtime.onMessage.addListener((/** @type {ToastMessage} */ message) => {
  if (message.type === 'SHOW_TOAST') {
    showToast(message.text, message.toastType);
  } else if (message.type === 'HIDE_TOAST') {
    hideToast();
  }
});
