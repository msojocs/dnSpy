import '@testing-library/jest-dom/vitest'

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
