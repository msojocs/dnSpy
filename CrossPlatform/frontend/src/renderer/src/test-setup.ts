import '@testing-library/jest-dom/vitest'

// jsdom lays nothing out and so implements no scrolling: the tree's scroll-into-view on a row the app
// selected on its own needs the method to exist. A no-op is enough — what the row asks for is asserted
// on directly in the tests that care.
Element.prototype.scrollIntoView = () => undefined

Object.defineProperty(window, 'dnSpy', {
  configurable: true,
  value: {
    minimizeWindow: async () => undefined,
    toggleMaximizeWindow: async () => false,
    closeWindow: async () => undefined,
    isWindowMaximized: async () => false,
    isRunningAsAdministrator: async () => false,
    restartAsAdministrator: async () => undefined,
    onWindowMaximizedChange: () => () => undefined,
  },
})
