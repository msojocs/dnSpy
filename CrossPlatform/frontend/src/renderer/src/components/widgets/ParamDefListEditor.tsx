import { useLanguage } from '../../localization'
import { ListEditor, type ListEditorItemProps, useRowComponent } from '../ListEditor'
import { ParamDefDialog } from './ParamDefDialog'
import { newParamDef, paramDefLabel, sequenceValue, type ParamDefDraft } from './param-def'
import type { TypeSigEditorOptions } from './TypeSigEditor'

interface ParamDefListEditorProps {
  workspaceId: string
  /** The parameters the method carries. They are drafts because a row's sequence is what is being typed
   * into a box; the method dialog converts them to and from what the backend takes. */
  items: ParamDefDraft[]
  onChange(items: ParamDefDraft[]): void
  /** What the marshal type's embedded signature editors may hold, which the rows inherit. */
  options?: TypeSigEditorOptions
  disabled?: boolean
  ariaLabel?: string
}

/**
 * A list of parameter rows — dnSpy's `ParamDefsVM`, whose rows are edited through `ParamDefDlg` and
 * shown as what each one says it is.
 *
 * A new row goes where its sequence number belongs rather than at the end, which is `GetAddIndex`: the
 * list is in sequence order until the user moves a row by hand, and a parameter numbered 2 added to a
 * method that has 1 and 3 already belongs between them.
 */
export const ParamDefListEditor = ({ workspaceId, items, onChange, options, disabled = false, ariaLabel }: ParamDefListEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const ItemDialog = useRowComponent(
    () => (props: ListEditorItemProps<ParamDefDraft>) => <ParamDefDialog workspaceId={workspaceId} options={options} {...props} />,
    [workspaceId, options],
  )
  return (
    <ListEditor
      items={items}
      onChange={onChange}
      label={paramDefLabel}
      create={newParamDef}
      itemDialog={ItemDialog}
      // A row whose sequence does not read has no place among the others, so it goes at the end.
      addIndex={(current, row) => {
        const sequence = sequenceValue(row.sequence)
        if (sequence === undefined)
          return current.length
        const at = current.findIndex((item) => {
          const other = sequenceValue(item.sequence)
          return other !== undefined && sequence < other
        })
        return at === -1 ? current.length : at
      }}
      disabled={disabled}
      ariaLabel={ariaLabel ?? t('Parameters')}
    />
  )
}
