import { useLanguage } from '../../localization'
import { ListEditor, type ListEditorItemProps, useRowComponent } from '../ListEditor'
import { GenericParamDialog } from './GenericParamDialog'
import { genericParamLabel, genericParamNumber, newGenericParam, type GenericParamDraft } from './generic-param'
import type { TypeSigEditorOptions } from './TypeSigEditor'

interface GenericParamListEditorProps {
  workspaceId: string
  /** The generic parameters the type or method carries. They are drafts because a row's number is what
   * is being typed into a box; the owner dialog converts them to and from what the backend takes. */
  items: GenericParamDraft[]
  onChange(items: GenericParamDraft[]): void
  /** What every signature inside a row may hold, which the rows inherit — see the dialog. */
  options?: TypeSigEditorOptions
  disabled?: boolean
  ariaLabel?: string
}

/**
 * A list of generic parameter rows — dnSpy's `GenericParamsVM`, whose rows are edited through
 * `GenericParamDlg` and shown as what each one says it is.
 *
 * A new row goes where its number belongs rather than at the end, which is `GetAddIndex`: the list is in
 * number order, and a parameter numbered 1 added to a type that already has 0 and 2 belongs between
 * them. A row whose number does not read has no place among the others, so it goes at the end — which
 * is what dnSpy's loop over a non-number amounts to as well.
 */
export const GenericParamListEditor = ({ workspaceId, items, onChange, options, disabled = false, ariaLabel }: GenericParamListEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const ItemDialog = useRowComponent(
    () => (props: ListEditorItemProps<GenericParamDraft>) => <GenericParamDialog workspaceId={workspaceId} options={options} {...props} />,
    [workspaceId, options],
  )
  return (
    <ListEditor
      items={items}
      onChange={onChange}
      label={genericParamLabel}
      create={newGenericParam}
      itemDialog={ItemDialog}
      addIndex={(current, row) => {
        const number = genericParamNumber(row.number)
        if (number === undefined)
          return current.length
        const at = current.findIndex((item) => {
          const other = genericParamNumber(item.number)
          return other !== undefined && number < other
        })
        return at === -1 ? current.length : at
      }}
      disabled={disabled}
      ariaLabel={ariaLabel ?? t('Generic Parameters')}
    />
  )
}
