import type { PropertySigDto } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import { describeTypeSig, NOT_SET } from './type-sig-text'
import { TypeSigEditor, type TypeSigEditorOptions } from './TypeSigEditor'
import { TypeSigListEditor } from './TypeSigListEditor'

interface PropertySigEditorProps {
  workspaceId: string
  value: PropertySigDto
  onChange(value: PropertySigDto): void
  options?: TypeSigEditorOptions
  disabled?: boolean
}

/** dnSpy's `PropertySigCreator`, which is how a `PropertySig` reads: the instance flag, then the
 * property's type, then the index parameter types. */
export const describePropertySig = (value: PropertySigDto, notSet: string = NOT_SET): string =>
  `${describeTypeSig(value.propertyType, notSet)}(${value.parameters.map((parameter) => describeTypeSig(parameter, notSet)).join(',')})`

/**
 * The property-signature editor, which is dnSpy's `MethodSigCreatorControl` handed a property: the same
 * control with the two halves a method signature has that a property does not. There is no calling
 * convention to pick — every `PropertySig` is `CallingConvention.Property` — so the combo is gone, and
 * with it the `# Generics` box: dnSpy's control shows that box for a property too, but only a signature
 * carrying the Generic flag can hold a count, and dnSpy's property path fixes the convention to
 * `Property` when it builds one. The HasThis box is what is left of the flags, which is why dnSpy's XAML
 * binds it to the same `CallingConvention.HasThis` bit either way.
 */
export const PropertySigEditor = ({ workspaceId, value, onChange, options, disabled = false }: PropertySigEditorProps): React.JSX.Element => {
  const { t } = useLanguage()

  return (
    <div className="methodsig-editor">
      <div className="typesig-preview">{describePropertySig(value, t(NOT_SET))}</div>
      <fieldset className="methodsig-flags">
        <legend>{t('Flags')}</legend>
        <label>
          <input type="checkbox" checked={value.hasThis} disabled={disabled} onChange={(event) => { onChange({ ...value, hasThis: event.target.checked }) }} />
          HasThis
        </label>
      </fieldset>
      <div className="methodsig-return">
        <span className="methodsig-return-label">{t('Return Type')}</span>
        <TypeSigEditor
          workspaceId={workspaceId}
          value={value.propertyType.kind === 'empty' ? null : value.propertyType}
          onChange={(next) => { onChange({ ...value, propertyType: next ?? { kind: 'empty' } }) }}
          options={options}
          disabled={disabled}
        />
      </div>
      <details className="methodsig-section" open>
        <summary>{t('Method Parameter Types')}</summary>
        <TypeSigListEditor
          workspaceId={workspaceId}
          values={value.parameters}
          onChange={(parameters) => { onChange({ ...value, parameters }) }}
          options={{ ...options, canAddFnPtr: false }}
          disabled={disabled}
        />
      </details>
    </div>
  )
}
