// Use JSDOM's isolated storage even on Node versions that expose a global of their own.
const { jsdom } = globalThis as typeof globalThis & { jsdom: { window: Window } }
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: jsdom.window.localStorage,
})
