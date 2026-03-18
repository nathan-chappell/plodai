const CHATKIT_AUTO_SCROLL_THRESHOLD_PX = 48;
const SCROLLABLE_OVERFLOW_VALUES = new Set(["auto", "scroll", "overlay"]);

export type ScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

export function isNearScrollBottom(
  metrics: ScrollMetrics,
  threshold = CHATKIT_AUTO_SCROLL_THRESHOLD_PX,
): boolean {
  return metrics.scrollHeight - (metrics.scrollTop + metrics.clientHeight) <= threshold;
}

export function findChatKitScrollTarget(
  host: HTMLElement,
  fallback?: HTMLElement | null,
): HTMLElement | null {
  const candidates = new Set<HTMLElement>();
  const roots: ParentNode[] = [host];

  if (host.shadowRoot) {
    roots.push(host.shadowRoot);
  }

  for (const root of roots) {
    if (root instanceof HTMLElement) {
      candidates.add(root);
    }
    for (const node of root.querySelectorAll("*")) {
      if (node instanceof HTMLElement) {
        candidates.add(node);
      }
    }
  }

  let bestScrollableCandidate: HTMLElement | null = null;
  let bestOverflow = -1;
  for (const element of candidates) {
    const style = window.getComputedStyle(element);
    if (!SCROLLABLE_OVERFLOW_VALUES.has(style.overflowY)) {
      continue;
    }
    const overflow = element.scrollHeight - element.clientHeight;
    if (overflow <= bestOverflow) {
      continue;
    }
    bestScrollableCandidate = element;
    bestOverflow = overflow;
  }

  if (bestScrollableCandidate) {
    return bestScrollableCandidate;
  }

  if (fallback) {
    return fallback;
  }

  return null;
}
