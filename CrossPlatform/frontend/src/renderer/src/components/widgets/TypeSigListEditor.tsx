import { useState } from 'react'
import type { TypeSigDto } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import { TypeSigEditor, type TypeSigEditorOptions } from './TypeSigEditor'
import { describeTypeSig, isTypeSigComplete } from './type-sig-text'

interface TypeSigListEditorProps {
  workspaceId: string
  values: TypeSigDto[]
  onChange(values: TypeSigDto[]): void
  options?: TypeSigEditorOptions
  /** How many entries the list is meant to hold, when something wants a fixed number of them; a list
   * without one can be added to for as long as the user likes, which is how dnSpy's is built. */
  requiredCount?: number
  disabled?: boolean
}

/**
 * A list of type signatures, built one at a time: dnSpy's `CreateTypeSigArrayControl` plus the Add and
 * Delete buttons its callers put beside it. Parameter lists and the arguments of a generic instance are
 * both edited with it.
 *
 * The entry being assembled is a draft the list owns — dnSpy clears its creator after every add for the
 * same reason — and only a whole signature can be added, since a half-built one is not something the
 * creator can express in the first place.
 */
export const TypeSigListEditor = ({ workspaceId, values, onChange, options, requiredCount, disabled = false }: TypeSigListEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<TypeSigDto | null>(null)
  const [selected, setSelected] = useState(-1)
  const notSet = t('(not set)')
  const full = requiredCount !== undefined && values.length >= requiredCount
  const canAdd = !disabled && !full && isTypeSigComplete(draft)
  const canRemove = !disabled && selected >= 0 && selected < values.length

  const add = (): void => {
    if (!canAdd || draft === null)
      return
    onChange([...values, draft])
    setSelected(values.length)
    setDraft(null)
  }

  const remove = (): void => {
    if (!canRemove)
      return
    onChange(values.filter((_, index) => index !== selected))
    setSelected(Math.min(selected, values.length - 2))
  }

  const move = (delta: number): void => {
    const target = selected + delta
    if (disabled || selected < 0 || target < 0 || target >= values.length)
      return
    const moved = [...values]
    ;[moved[selected], moved[target]] = [moved[target], moved[selected]]
    onChange(moved)
    setSelected(target)
  }

  return (
    <div className="typesig-list-editor">
      <TypeSigEditor
        workspaceId={workspaceId}
        value={draft}
        onChange={setDraft}
        options={options}
        disabled={disabled || full}
      />
      <div className="typesig-list-body">
        <div className="typesig-list" role="listbox" aria-label={t('Types')}>
          {values.map((entry, index) => (
            <div
              key={index}
              role="option"
              aria-selected={index === selected}
              className={`typesig-list-row${index === selected ? ' selected' : ''}`}
              title={describeTypeSig(entry, notSet)}
              onClick={() => { setSelected(index) }}
            >
              {describeTypeSig(entry, notSet)}
            </div>
          ))}
        </div>
        <div className="typesig-list-move">
          <button type="button" disabled={disabled || selected <= 0} title={t('Move Up')} aria-label={t('Move Up')} onClick={() => { move(-1) }}>↑</button>
          <button type="button" disabled={disabled || selected < 0 || selected >= values.length - 1} title={t('Move Down')} aria-label={t('Move Down')} onClick={() => { move(1) }}>↓</button>
        </div>
      </div>
      <div className="typesig-buttons">
        <button type="button" disabled={!canAdd} onClick={add}>{t('Add')}</button>
        <button type="button" disabled={!canRemove} onClick={remove}>{t('Delete')}</button>
      </div>
    </div>
  )
}
