import type { DnSpyApi } from '../../shared/protocol'

declare global {
  interface Window {
    dnSpy: DnSpyApi
  }
}

export {}
