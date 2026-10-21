import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; the deck canvas already guards for its absence,
// but other browser-only APIs used by the shell need stubs too.
if (typeof window !== "undefined") {
  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
  if (!("matchMedia" in window)) {
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    });
  }
}
