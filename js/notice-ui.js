function buildDismissibleNotice(id) {
  const notice = document.createElement('div');
  notice.id = id;
  notice.className = 'notice notice--dismissible';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.setAttribute('aria-atomic', 'true');

  const text = document.createElement('span');
  text.className = 'notice__text';
  notice.appendChild(text);

  const dismiss = document.createElement('button');
  dismiss.className = 'notice__dismiss';
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss message');
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => {
    notice.style.display = 'none';
    notice.setAttribute('aria-hidden', 'true');
  });
  notice.appendChild(dismiss);

  return notice;
}

export function showPersistentNotice(anchor, msg, options = {}) {
  if (!anchor || !anchor.parentElement) return null;

  const id = options.id || 'cf-notice';
  const kind = options.kind || 'warning';
  let notice = document.getElementById(id);
  if (!notice) {
    notice = buildDismissibleNotice(id);
    anchor.parentElement.insertBefore(notice, anchor.nextSibling);
  }

  const text = notice.querySelector('.notice__text');
  if (text) text.textContent = msg;
  notice.dataset.kind = kind;
  notice.style.display = '';
  notice.setAttribute('aria-hidden', 'false');
  return notice;
}
