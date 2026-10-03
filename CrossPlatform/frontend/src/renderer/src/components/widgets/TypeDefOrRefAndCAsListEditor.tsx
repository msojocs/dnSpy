import { useLanguage } from '../../localization'
import { ListEditor, type ListEditorItemProps, useRowComponent } from '../ListEditor'
import { typeDefOrRefAndCaLabel, newTypeDefOrRefAndCa, type TypeDefOrRefAndCaDraft } from './type-def-or-ref-and-ca'
import { TypeDefOrRefAndCaDialog } from './TypeDefOrRefAndCaDialog'
import type { TypeSigEditorOptions } from './TypeSigEditor'

interface TypeDefOrRefAndCAsListEditorProps {
  workspaceId: string
  /** The rows the owner carries. They are drafts because a row being added names no type yet; the owner
   * converts them to and from what the backend takes. */
  items: TypeDefOrRefAndCaDraft[]
  onChange(items: TypeDefOrRefAndCaDraft[]): void
  /** What each row's signature editor may hold — see the dialog, which is where dnSpy decides it. */
  options?: TypeSigEditorOptions
  /** The two titles dnSpy's `ListVM` is built with, which are the dialog's own title. */
  editTitle: string
  createTitle: string
  disabled?: boolean
  ariaLabel?: string
}

/**
 * A list of types and their attributes — dnSpy's `TypeDefOrRefAndCAsVM`, which serves both a generic
 * parameter's constraints and a type's implemented interfaces: the two are the same row of the same
 * shape, and only the strings differ.
 */
export const TypeDefOrRefAndCAsListEditor = ({ workspaceId, items, onChange, options, editTitle, createTitle, disabled = false, ariaLabel }: TypeDefOrRefAndCAsListEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const ItemDialog = useRowComponent(
    () => (props: ListEditorItemProps<TypeDefOrRefAndCaDraft>) => (
      <TypeDefOrRefAndCaDialog workspaceId={workspaceId} editTitle={editTitle} createTitle={createTitle} options={options} {...props} />
    ),
    [workspaceId, editTitle, createTitle, options],
  )
  return (
    <ListEditor
      items={items}
      onChange={onChange}
      label={typeDefOrRefAndCaLabel}
      create={newTypeDefOrRefAndCa}
      itemDialog={ItemDialog}
      disabled={disabled}
      ariaLabel={ariaLabel ?? t('Types')}
    />
  )
}
