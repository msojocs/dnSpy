using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Converts custom attributes, and the argument values inside them, to and from their DTOs.
/// </summary>
/// <remarks>
/// An argument's declared type is what dnlib reads the value with, so the DTO carries both and the value
/// is decoded against the type rather than guessed from the value's own shape. Only the constructor's
/// identity and the values travel: the constructor's signature is what decides how many arguments there
/// are and what type each one is, which is the same rule dnSpy's <c>CustomAttributeVM</c> follows when it
/// rebuilds the list after the constructor changes.
/// </remarks>
public sealed class CustomAttributeCodec {
	readonly EditContext context;

	internal CustomAttributeCodec(EditContext context) => this.context = context;

	public CustomAttributeDto ToDto(CustomAttribute? attribute) => attribute is null
		? throw SignatureCodec.Invalid("A custom attribute is required.")
		: new CustomAttributeDto(
			context.MethodRefs.ToDto(attribute.Constructor),
			[.. attribute.ConstructorArguments.Select(ToDto)],
			[.. attribute.NamedArguments.Select(ToDto)],
			attribute.AttributeType?.FullName ?? string.Empty);

	public CustomAttribute FromDto(CustomAttributeDto? dto) => dto is null
		? throw SignatureCodec.Invalid("A custom attribute is required.")
		: new CustomAttribute(
			context.MethodRefs.FromDto(dto.Constructor),
			[.. (dto.ConstructorArguments ?? []).Select(FromDto)],
			[.. (dto.NamedArguments ?? []).Select(FromDto)]);

	public IReadOnlyList<CustomAttributeDto> ToDtoList(IEnumerable<CustomAttribute>? attributes) =>
		[.. (attributes ?? []).Select(ToDto)];

	public IList<CustomAttribute> FromDtoList(IEnumerable<CustomAttributeDto>? attributes) =>
		[.. (attributes ?? []).Select(FromDto)];

	CaArgumentDto ToDto(CAArgument argument) =>
		new(context.Signatures.ToDtoRequired(argument.Type), ToDto(argument.Type, argument.Value));

	CAArgument FromDto(CaArgumentDto dto) =>
		new(context.Signatures.FromDtoRequired(dto.Type), FromDto(context.Signatures.FromDtoRequired(dto.Type), dto.Value));

	/// <summary>
	/// A named argument on its own. A <c>DeclSecurity</c> row holds its values as named arguments with no
	/// constructor behind them, so the pair is needed outside the custom attribute itself.
	/// </summary>
	internal CaNamedArgumentDto ToDto(CANamedArgument argument) =>
		new(argument.IsField, argument.Name.String, ToDto(argument.Argument));

	internal CANamedArgument FromDto(CaNamedArgumentDto dto) {
		var argument = FromDto(dto.Argument);
		return new CANamedArgument(dto.IsField, argument.Type, dto.Name, argument);
	}

	/// <summary>
	/// Reads a value out of the model. A boxed value is a <see cref="CAArgument"/> wrapped in another
	/// one, so it is recognized before the leaf shapes; the rest are told apart by their runtime type.
	/// </summary>
	CaValueDto ToDto(TypeSig type, object? value) => value switch {
		null => new CaValueDto(CaValueKinds.Null),
		UTF8String text => new CaValueDto(CaValueKinds.String, Text: text.String),
		string text => new CaValueDto(CaValueKinds.String, Text: text),
		TypeSig referenced => new CaValueDto(CaValueKinds.Type, ReferencedType: context.Signatures.ToDto(referenced)),
		IList<CAArgument> elements => new CaValueDto(CaValueKinds.Array, Elements: [.. elements.Select(ToDto)]),
		CAArgument boxed => new CaValueDto(
			CaValueKinds.Struct,
			Elements: [ToDto(boxed)],
			ElementType: (int)DnlibDisplay.ElementTypeOf(boxed.Value)),
		_ => new CaValueDto(
			CaValueKinds.Primitive,
			Primitive: DnlibDisplay.LiteralText(value),
			ElementType: (int)DnlibDisplay.ElementTypeOf(value)),
	};

	/// <summary>
	/// Writes a value back. A primitive is read with the element type the DTO recorded rather than the
	/// one the argument is declared as, because an enum argument stores a primitive under an enum type
	/// and a boxed one stores a primitive under <c>System.Object</c>.
	/// </summary>
	object? FromDto(TypeSig type, CaValueDto? value) {
		if (value is null)
			return null;
		return value.Kind switch {
			CaValueKinds.Null => null,
			CaValueKinds.String => new UTF8String(value.Text ?? string.Empty),
			CaValueKinds.Type => context.Signatures.FromDtoRequired(value.ReferencedType),
			CaValueKinds.Array => (IList<CAArgument>)[.. (value.Elements ?? []).Select(FromDto)],
			CaValueKinds.Struct => FromDto(BoxedArgument(value)),
			CaValueKinds.Primitive => ParseLiteral(type, value),
			_ => throw SignatureCodec.Invalid($"Unknown custom attribute value kind '{value.Kind}'."),
		};
	}

	/// <summary>
	/// Unwraps a boxed value. The wrapper exists in the DTO so that the shape survives the round trip,
	/// but dnlib holds a boxed object argument as the single argument it wrapped, so it comes straight
	/// back off.
	/// </summary>
	static CaArgumentDto BoxedArgument(CaValueDto value) {
		var elements = value.Elements ?? [];
		return elements.Count == 1
			? elements[0]
			: throw SignatureCodec.Invalid("A boxed value needs exactly one inner argument.");
	}

	object ParseLiteral(TypeSig type, CaValueDto value) {
		var elementType = value.ElementType == (int)ElementType.End
			? DnlibDisplay.UnderlyingElementType(type)
			: (ElementType)value.ElementType;
		return DnlibDisplay.ParseLiteral(elementType, value.Primitive)
			?? throw SignatureCodec.Invalid($"A '{DnlibDisplay.Type(type)}' argument cannot hold a literal.");
	}
}
