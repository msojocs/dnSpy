import type { ImplMapDto } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import { fieldEntries, fieldValue, hasFlag, implMapError, newImplMap, P_INVOKE, P_INVOKE_FIELDS, withFieldValue, withFlag } from './pinvoke'

interface ImplMapEditorProps {
  /** The P/Invoke row, or undefined when the item is not one — which is what the Enable checkbox says. */
  value: ImplMapDto | undefined
  onChange(value: ImplMapDto | undefined): void
  disabled?: boolean
}

/**
 * dnSpy's `ImplMapControl`: a groupbox whose header is the Enable checkbox, then the entry point and the
 * native library on one row, the two standalone attribute flags on the next, and the four bit fields of
 * the attribute word on the last two. Which bits those are is all `PInvokeAttributes` says; the row
 * carries the whole word, so a flag the four combos do not cover would still travel.
 */
export const ImplMapEditor = ({ value, onChange, disabled = false }: ImplMapEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const enabled = !disabled && value !== undefined
  const attributes = value?.attributes ?? 0
  const error = implMapError(value)

  const edit = (patch: Partial<ImplMapDto>): void => { if (value) onChange({ ...value, ...patch }) }

  const flag = (label: string, bit: number): React.JSX.Element => (
    <label className="options-row">
      <input
        type="checkbox"
        checked={hasFlag(attributes, bit)}
        disabled={!enabled}
        onChange={(event) => { edit({ attributes: withFlag(attributes, bit, event.target.checked) }) }}
      />
      {label}
    </label>
  )

  const textField = (label: string, key: 'name' | 'moduleName'): React.JSX.Element => (
    <div className="marshal-field">
      <span className="marshal-label">{t(label)}</span>
      <input
        aria-label={t(label)}
        value={value?.[key] ?? ''}
        disabled={!enabled}
        onChange={(event) => { edit({ [key]: event.target.value }) }}
      />
    </div>
  )

  return (
    <fieldset className="ca-group implmap">
      <legend>
        <label className="options-row">
          <input
            type="checkbox"
            checked={value !== undefined}
            disabled={disabled}
            onChange={(event) => { onChange(event.target.checked ? newImplMap() : undefined) }}
          />
          {t('Enable')}
        </label>
      </legend>

      <div className="implmap-grid">
        {textField('Name', 'name')}
        {textField('Module', 'moduleName')}
        {flag('NoMangle', P_INVOKE.NoMangle)}
        {flag('SupportsLastError', P_INVOKE.SupportsLastError)}
        {P_INVOKE_FIELDS.map((field) => (
          <div className="marshal-field" key={field.label}>
            {/* dnSpy abbreviates the third one and puts the full name in its tooltip. */}
            <span className="marshal-label" title={field.tooltip ? t(field.tooltip) : undefined}>{t(field.label)}</span>
            <select
              aria-label={t(field.label)}
              title={field.tooltip ? t(field.tooltip) : undefined}
              value={fieldValue(attributes, field)}
              disabled={!enabled}
              onChange={(event) => { edit({ attributes: withFieldValue(attributes, field, Number(event.target.value)) }) }}
            >
              {fieldEntries(field, fieldValue(attributes, field)).map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {error && <div className="options-error">{t(error)}</div>}
    </fieldset>
  )
}
