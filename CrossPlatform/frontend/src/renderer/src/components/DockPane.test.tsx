import { Actions, Model, TabNode, type IJsonModel } from 'flexlayout-react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DockPane } from './DockPane'

const createModel = (): Model => Model.fromJson({
  global: { tabSetEnableDeleteWhenEmpty: true },
  layout: {
    type: 'row',
    children: [
      {
        type: 'tabset',
        id: 'explorer-dock',
        tabLocation: 'bottom',
        children: [{ type: 'tab', id: 'explorer', name: 'Assembly Explorer', component: 'explorer', enableClose: true }],
      },
      {
        type: 'tabset',
        id: 'toolwindows',
        selected: 0,
        children: [
          { type: 'tab', id: 'locals', name: 'Locals', component: 'locals', enableClose: true },
          { type: 'tab', id: 'watch', name: 'Watch 1', component: 'watch', enableClose: true },
        ],
      },
    ],
  },
} satisfies IJsonModel)

const tabOf = (model: Model, id: string): TabNode => {
  const tab = model.getNodeById(id)
  if (!(tab instanceof TabNode)) throw new Error(`Missing tab ${id}`)
  return tab
}

afterEach(cleanup)

describe('DockPane', () => {
  it('titles the pane with its tab and closes that tab from the caption', () => {
    const model = createModel()
    render(<DockPane tab={tabOf(model, 'locals')}><div>grid</div></DockPane>)

    expect(screen.getByText('Locals')).toBeDefined()
    expect(screen.getByText('grid')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(model.getNodeById('locals')).toBeUndefined()
    expect(model.getNodeById('watch')).not.toBeUndefined()
  })

  it('marks the caption of the pane that is active, and only that one', () => {
    const model = createModel()
    const { container: idle } = render(<DockPane tab={tabOf(model, 'locals')}><div /></DockPane>)
    expect(idle.querySelector('.dock-caption')?.classList.contains('dock-caption-active')).toBe(false)

    cleanup()
    // The pane last worked in wears the blue caption, as it does upstream.
    model.doAction(Actions.setActiveTabset('toolwindows'))
    const { container: active } = render(<DockPane tab={tabOf(model, 'locals')}><div /></DockPane>)
    expect(active.querySelector('.dock-caption')?.classList.contains('dock-caption-active')).toBe(true)
  })

  it('will not close a pane whose tab cannot be closed', () => {
    const model = createModel()
    const explorer = tabOf(model, 'explorer')
    model.doAction(Actions.updateNodeAttributes(explorer.getId(), { enableClose: false }))
    render(<DockPane tab={explorer}><div /></DockPane>)

    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
