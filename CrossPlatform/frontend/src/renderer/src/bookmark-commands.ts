import { useAppStore } from './app-store'
import { activeDocumentPosition } from './editor-registry'

// The bookmark commands dnSpy puts on its View menu, its shortcuts and its window's toolbar. They live
// in one place because all three have to agree on the target: "the bookmark at the caret" means the
// caret of the code editor the user last typed in, which only the editor registry knows.

export const toggleBookmarkAtCaret = (): void => {
  const position = activeDocumentPosition()
  if (position)
    useAppStore.getState().toggleBookmark(position.documentId, position.line, position.column)
}

export const toggleBookmarkEnabledAtCaret = (): void => {
  const position = activeDocumentPosition()
  if (position)
    useAppStore.getState().toggleBookmarkEnabledAt(position.documentId, position.line, position.column)
}

/** Walks the bookmarks: every enabled one, those of the current document, or those sharing a label. */
export const stepBookmark = (direction: 1 | -1, scope: 'all' | 'document' | 'label' = 'all'): void => {
  const state = useAppStore.getState()
  if (scope === 'label') {
    void (direction > 0 ? state.selectNextBookmarkWithSameLabel() : state.selectPreviousBookmarkWithSameLabel())
    return
  }
  const position = activeDocumentPosition()
  if (scope === 'document') {
    if (position)
      void (direction > 0 ? state.selectNextBookmarkInDocument(position.documentId, position.line) : state.selectPreviousBookmarkInDocument(position.documentId, position.line))
    return
  }
  void (direction > 0 ? state.selectNextBookmark(position) : state.selectPreviousBookmark(position))
}

/** Removes every bookmark, the way dnSpy's Clear Bookmarks does — silently, with no confirmation. */
export const clearBookmarks = (): void => useAppStore.getState().clearBookmarks()

/** Removes the bookmarks of the document the user is in, leaving every other one alone. */
export const clearBookmarksInDocument = (): void => {
  const position = activeDocumentPosition()
  if (position)
    useAppStore.getState().removeAllBookmarksInDocument(position.documentId)
}

export const showBookmarksWindow = (): void => useAppStore.getState().openToolWindow?.('bookmarks')
