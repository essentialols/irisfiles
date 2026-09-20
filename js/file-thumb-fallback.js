/**
 * Replace source thumbnails that the browser cannot render natively with a
 * readable file-type tile. This is especially useful for formats IrisFiles can
 * convert through a decoder (for example HEIC/HEIF) even when <img> cannot
 * preview the original file.
 */

function fileTypeLabel(fileName) {
  const match = /\.([^.]+)$/.exec(fileName || '');
  const ext = match?.[1]?.replace(/[^a-z0-9]/gi, '').slice(0, 5);
  return ext ? ext.toUpperCase() : 'FILE';
}

function showFallback(img) {
  const thumb = img.closest('.file-item__thumb');
  if (!thumb || thumb.querySelector('.file-item__thumb-fallback')) return;

  const fileName = thumb.closest('.file-item')
    ?.querySelector('.file-item__name')
    ?.textContent || '';

  img.style.display = 'none';

  const tile = document.createElement('span');
  tile.className = 'route-thumb-tile file-item__thumb-fallback';
  tile.setAttribute('aria-hidden', 'true');

  const ext = document.createElement('span');
  ext.className = 'route-thumb-tile__ext';
  ext.textContent = fileTypeLabel(fileName);
  tile.appendChild(ext);
  thumb.appendChild(tile);
}

function watchThumbnail(img) {
  if (!(img instanceof HTMLImageElement) || img.dataset.thumbFallbackBound) return;
  img.dataset.thumbFallbackBound = 'true';
  img.addEventListener('error', () => showFallback(img), { once: true });

  // A very fast decode failure can happen before MutationObserver attaches the
  // listener. complete + naturalWidth=0 is the browser's already-failed state.
  if (img.complete && img.naturalWidth === 0) showFallback(img);
}

export function installFileThumbFallback() {
  document.querySelectorAll('.file-item__thumb img').forEach(watchThumbnail);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.file-item__thumb img')) watchThumbnail(node);
        node.querySelectorAll?.('.file-item__thumb img').forEach(watchThumbnail);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}
