using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Reads and writes a type definition, ported from dnSpy's <c>TypeDefOptions</c>.
/// </summary>
/// <remarks>
/// The four collection rows — custom attributes, security declarations, generic parameters and
/// interfaces — are rebuilt from the DTO rather than merged into what the type already has, exactly as
/// dnSpy does: the dialog hands back the whole list every time, so a row the user removed has to go.
/// Editing a nested type does not touch its declaring type; a nested type is a row of its own and is
/// reached through its owner's list.
/// </remarks>
public sealed class TypeDefEditor {
	readonly EditContext context;

	internal TypeDefEditor(EditContext context) => this.context = context;

	public TypeOptionsDto ToDto(TypeDef? type) => type is null
		? throw SignatureCodec.Invalid("A type is required.")
		: new TypeOptionsDto(
			(int)type.Attributes,
			type.Namespace.String,
			type.Name.String,
			type.ClassLayout?.PackingSize,
			type.ClassLayout?.ClassSize,
			type.BaseType is { } baseType ? context.Signatures.ToDto(baseType) : null,
			context.Attributes.ToDtoList(type.CustomAttributes),
			context.DeclSecurities.ToDtoList(type.DeclSecurities),
			context.GenericParams.ToDtoList(type.GenericParameters),
			[.. type.Interfaces.Select(ToDto)],
			type.GenericParameters.Count,
			context.Signatures.CorLibScope);

	/// <summary>Adds a type to the module, row id and all, without putting it in any list yet.</summary>
	public TypeDef Create(TypeOptionsDto dto) =>
		context.Module.UpdateRowId(CopyTo(new TypeDefUser(UTF8String.Empty), dto));

	public TypeDef CopyTo(TypeDef type, TypeOptionsDto dto) {
		type.Attributes = (TypeAttributes)dto.Attributes;
		type.Namespace = dto.Namespace;
		type.Name = dto.Name;
		// A layout of zeroes is what dnSpy reads as "this type has no layout", so it is dropped rather
		// than written back as a row the type never had.
		type.ClassLayout = dto.PackingSize is null && dto.ClassSize is null
			? null
			: context.Module.UpdateRowId(new ClassLayoutUser((ushort)(dto.PackingSize ?? 0), dto.ClassSize ?? 0));
		type.BaseType = dto.BaseType is null
			? null
			: context.Signatures.FromDtoRequired(dto.BaseType).ToTypeDefOrRef();

		type.CustomAttributes.Clear();
		foreach (var attribute in context.Attributes.FromDtoList(dto.CustomAttributes))
			type.CustomAttributes.Add(attribute);
		type.DeclSecurities.Clear();
		foreach (var security in context.DeclSecurities.FromDtoList(dto.DeclSecurities))
			type.DeclSecurities.Add(security);
		type.GenericParameters.Clear();
		foreach (var parameter in context.GenericParams.FromDtoList(dto.GenericParameters))
			type.GenericParameters.Add(parameter);
		type.Interfaces.Clear();
		foreach (var implementation in dto.Interfaces ?? [])
			type.Interfaces.Add(FromDto(implementation));
		return type;
	}

	TypeDefOrRefAndCaDto ToDto(InterfaceImpl implementation) => new(
		context.Signatures.ToDtoRequired(implementation.Interface?.ToTypeSig()),
		context.Attributes.ToDtoList(implementation.CustomAttributes),
		implementation.Interface?.FullName ?? string.Empty);

	InterfaceImpl FromDto(TypeDefOrRefAndCaDto dto) {
		var implementation = context.Module.UpdateRowId(new InterfaceImplUser(
			context.Signatures.FromDtoRequired(dto.TypeDefOrRef).ToTypeDefOrRef()));
		foreach (var attribute in context.Attributes.FromDtoList(dto.CustomAttributes))
			implementation.CustomAttributes.Add(attribute);
		return implementation;
	}
}
