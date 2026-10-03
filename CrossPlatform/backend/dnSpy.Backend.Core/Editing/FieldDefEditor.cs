using dnlib.DotNet;
using dnlib.PE;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Reads and writes a field definition, ported from dnSpy's <c>FieldDefOptions</c>.
/// </summary>
/// <remarks>
/// A field's type is carried as a plain type signature and wrapped in a <c>FieldSig</c> on the way back,
/// which is what dnSpy's dialog does — the calling convention of a field signature is fixed, so only the
/// type is worth editing. The initial value is the bytes of a field with a field RVA, in base64 because
/// JSON has no byte string; it is kept only while the RVA attribute is set, which is the rule dnSpy's own
/// view model applies before it builds its options.
/// </remarks>
public sealed class FieldDefEditor {
	readonly EditContext context;

	internal FieldDefEditor(EditContext context) => this.context = context;

	public FieldOptionsDto ToDto(FieldDef? field) => field is null
		? throw SignatureCodec.Invalid("A field is required.")
		: new FieldOptionsDto(
			(int)field.Attributes,
			field.Name.String,
			context.Signatures.ToDto(field.FieldSig?.Type),
			field.FieldOffset,
			context.MarshalTypes.ToDto(field.MarshalType),
			field.InitialValue is null ? null : Convert.ToBase64String(field.InitialValue),
			context.ImplMaps.ToDto(field.ImplMap),
			context.Constants.ToDto(field.Constant),
			context.Attributes.ToDtoList(field.CustomAttributes),
			(uint)field.RVA,
			field.DeclaringType?.GenericParameters.Count ?? 0);

	/// <summary>Adds a field to the module, row id and all, without putting it in any type yet.</summary>
	public FieldDef Create(FieldOptionsDto dto) =>
		context.Module.UpdateRowId(CopyTo(new FieldDefUser(), dto));

	public FieldDef CopyTo(FieldDef field, FieldOptionsDto dto) {
		var attributes = (FieldAttributes)dto.Attributes;
		field.Attributes = attributes;
		field.Name = dto.Name;
		field.FieldSig = dto.FieldSig is null ? null : new FieldSig(context.Signatures.FromDtoRequired(dto.FieldSig));
		field.FieldOffset = dto.FieldOffset;
		field.MarshalType = context.MarshalTypes.FromDto(dto.MarshalType);
		field.RVA = (RVA)dto.Rva;
		field.InitialValue = (attributes & FieldAttributes.HasFieldRVA) != 0 && dto.InitialValue is not null
			? Convert.FromBase64String(dto.InitialValue)
			: null;
		field.ImplMap = context.ImplMaps.FromDto(dto.ImplMap);
		field.Constant = context.Constants.FromDto(dto.Constant);

		field.CustomAttributes.Clear();
		foreach (var attribute in context.Attributes.FromDtoList(dto.CustomAttributes))
			field.CustomAttributes.Add(attribute);
		return field;
	}
}
