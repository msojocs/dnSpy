import type { CaArgumentDto, CaNamedArgumentDto } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import { ListEditor, type ListEditorInlineProps, useRowComponent } from '../ListEditor'
import { CaArgumentEditor } from './CaArgumentEditor'
import { caArgumentDisplay } from './ca-value'
import { newNamedArgument } from './custom-attribute'

/** dnSpy's `CANamedArgumentVM.ToString`: the name and the value, which is the row's tooltip. */
export const caNamedArgumentLabel = (named: CaNamedArgumentDto): string =>
  `${named.name} = ${caArgumentDisplay(named.argument)}`

interface CaNamedArgumentEditorProps extends ListEditorInlineProps<CaNamedArgumentDto> {
  workspaceId: string
}

/**
 * One named argument's row — dnSpy's `CANamedArgumentControl`. The type combo comes first, then the
 * Field/Property combo and the name, and the value editor sits on the second line.
 *
 * dnSpy puts two kind combos on this row: the row's own, which lists `Object` first, and the one inside
 * the value editor below it, which lists `Null` first, and it keeps the second one following the first.
 * The first is the one modelled here — the second only ever echoes it, and a set of two combo boxes that
 * a single selection drives is one combo with a duplicate in it.
 */
export const CaNamedArgumentEditor = ({ workspaceId, value, onChange, disabled }: CaNamedArgumentEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  return (
    <div className="ca-named-argument">
      <div className="ca-named-argument-row">
        <select
          aria-label={t('Property/Field type')}
          title={t('Property/Field type')}
          value={value.isField ? 'field' : 'property'}
          disabled={disabled}
          onChange={(event) => { onChange({ ...value, isField: event.target.value === 'field' }) }}
        >
          <option value="field">{t('Field')}</option>
          <option value="property">{t('Property')}</option>
        </select>
        <label className="ca-named-argument-name">
          {t('Name')}
          <input value={value.name} disabled={disabled} onChange={(event) => { onChange({ ...value, name: event.target.value }) }} />
        </label>
      </div>
      <CaArgumentEditor
        workspaceId={workspaceId}
        value={value.argument}
        onChange={(argument: CaArgumentDto) => { onChange({ ...value, argument }) }}
        allowNull={false}
        disabled={disabled}
      />
    </div>
  )
}

interface CaNamedArgumentListEditorProps {
  workspaceId: string
  items: CaNamedArgumentDto[]
  onChange(items: CaNamedArgumentDto[]): void
  disabled?: boolean
  ariaLabel?: string
}

/**
 * The named arguments of a custom attribute: dnSpy's `CANamedArgumentsVM`, which is the one list built
 * with `inlineEditing: true` — its rows are their own editors, so there is no Edit... button and Add
 * writes a fresh row straight in.
 */
export const CaNamedArgumentListEditor = ({ workspaceId, items, onChange, disabled = false, ariaLabel }: CaNamedArgumentListEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const InlineArgument = useRowComponent(
    () => (props: ListEditorInlineProps<CaNamedArgumentDto>) => <CaNamedArgumentEditor workspaceId={workspaceId} {...props} />,
    [workspaceId],
  )
  return (
    <ListEditor
      items={items}
      onChange={onChange}
      label={caNamedArgumentLabel}
      create={newNamedArgument}
      inlineItem={InlineArgument}
      disabled={disabled}
      ariaLabel={ariaLabel ?? t('Named Arguments')}
    />
  )
}
