using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Reads and writes a property definition, ported from dnSpy's <c>PropertyDefOptions</c>.
/// </summary>
/// <remarks>
/// The accessor lists are the delicate part. dnlib keeps the "this method is the getter" marks on the
/// methods themselves and writes the <c>MethodSemantics</c> rows straight out of them, so a method that
/// stops being an accessor has to have its mark cleared: every method in the old lists loses its mark
/// first, then every method in the new lists gains one. Clearing after setting would leave a method that
/// moved from getter to setter marked as both. A property is created with no accessors at all, which is
/// what dnSpy does — the signature it starts from is a bare <c>Int32</c> instance or static property.
/// </remarks>
public sealed class PropertyDefEditor {
	readonly EditContext context;

	internal PropertyDefEditor(EditContext context) => this.context = context;

	public PropertyOptionsDto ToDto(PropertyDef? property) => property is null
		? throw SignatureCodec.Invalid("A property is required.")
		: new PropertyOptionsDto(
			(int)property.Attributes,
			property.Name.String,
			property.PropertySig is { } signature ? context.Signatures.PropertyToDto(signature) : null,
			context.Constants.ToDto(property.Constant),
			context.Accessors.ToDtoList(property.GetMethods),
			context.Accessors.ToDtoList(property.SetMethods),
			context.Accessors.ToDtoList(property.OtherMethods),
			context.Attributes.ToDtoList(property.CustomAttributes));

	/// <summary>Adds a property to the module, row id and all, without putting it in any type yet.</summary>
	public PropertyDef Create(TypeDef owner, PropertyOptionsDto dto) =>
		context.Module.UpdateRowId(CopyTo(new PropertyDefUser(), owner, dto));

	/// <param name="owner">The type the accessors are looked up in; a property cannot name a method of
	/// another type.</param>
	public PropertyDef CopyTo(PropertyDef property, TypeDef owner, PropertyOptionsDto dto) {
		property.Attributes = (PropertyAttributes)dto.Attributes;
		property.Name = dto.Name;
		property.PropertySig = dto.PropertySig is null ? null : context.Signatures.PropertyFromDto(dto.PropertySig);
		property.Constant = context.Constants.FromDto(dto.Constant);

		foreach (var method in property.GetMethods)
			method.IsGetter = false;
		foreach (var method in property.SetMethods)
			method.IsSetter = false;
		foreach (var method in property.OtherMethods)
			method.IsOther = false;

		var getters = context.Accessors.FindAll(owner, dto.GetMethods);
		var setters = context.Accessors.FindAll(owner, dto.SetMethods);
		var others = context.Accessors.FindAll(owner, dto.OtherMethods);
		foreach (var method in getters)
			method.IsGetter = true;
		foreach (var method in setters)
			method.IsSetter = true;
		foreach (var method in others)
			method.IsOther = true;

		Replace(property.GetMethods, getters);
		Replace(property.SetMethods, setters);
		Replace(property.OtherMethods, others);

		property.CustomAttributes.Clear();
		foreach (var attribute in context.Attributes.FromDtoList(dto.CustomAttributes))
			property.CustomAttributes.Add(attribute);
		return property;
	}

	static void Replace(IList<MethodDef> accessors, IList<MethodDef> replacements) {
		accessors.Clear();
		foreach (var method in replacements)
			accessors.Add(method);
	}
}
