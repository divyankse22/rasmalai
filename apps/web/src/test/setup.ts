import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/*
 * jsdom is missing several browser APIs this app touches. Each stub below exists because some
 * component actually calls it — none are speculative.
 */

// `globals` is off, so Testing Library's automatic cleanup never registers itself.
afterEach(cleanup);

// The reduced-motion check, and anything that grows a media query later.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// Not used today, but cheap, and the failure mode without it is an unhelpful stack.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// OnboardingWizard moves focus between steps.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// PairingPanel copies the pairing code. Tests that assert on it should read this mock.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => {}), readText: vi.fn(async () => '') },
    configurable: true,
  });
}

/*
 * RealtimeProvider opens a socket on mount. A test must never open a real one — it would hang the
 * run and, worse, could reach a live server. This stub is inert by design: it connects to nothing
 * and delivers nothing. Tests that need to drive protocol frames should render against a fake
 * provider rather than trying to animate this.
 */
class InertWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = InertWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }
  send() {}
  close() {
    this.readyState = InertWebSocket.CLOSED;
  }
  addEventListener() {}
  removeEventListener() {}
}

globalThis.WebSocket = InertWebSocket as unknown as typeof WebSocket;
