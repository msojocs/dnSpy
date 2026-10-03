using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>Converts a type's or method's generic parameters to and from their DTOs.</summary>
public sealed class GenericParamCodec {
	readonly EditContext context;

	internal GenericParamCodec(EditContext context) => this.context = context;

	public GenericParamDto ToDto(GenericParam? parameter) => parameter is null
		? throw SignatureCodec.Invalid("A generic parameter is required.")
		: new GenericParamDto(
			parameter.Number,
			(int)parameter.Flags,
			parameter.Name.String,
			parameter.Kind is { } kind ? context.Signatures.ToDto(kind) : null,
			[.. parameter.GenericParamConstraints.Select(ToDto)],
			context.Attributes.ToDtoList(parameter.CustomAttributes),
			Display(parameter));

	public GenericParam FromDto(GenericParamDto? dto) {
		if (dto is null)
			throw SignatureCodec.Invalid("A generic parameter is required.");
		var number = (ushort)dto.Number;
		var parameter = context.Module.UpdateRowId(new GenericParamUser(number, (GenericParamAttributes)dto.Flags, dto.Name));
		parameter.Kind = dto.Kind is { } kind ? context.Signatures.FromDtoRequired(kind).ToTypeDefOrRef() : null;
		foreach (var constraint in dto.Constraints ?? [])
			parameter.GenericParamConstraints.Add(FromDto(constraint));
		foreach (var attribute in context.Attributes.FromDtoList(dto.CustomAttributes))
			parameter.CustomAttributes.Add(attribute);
		return parameter;
	}

	public IReadOnlyList<GenericParamDto> ToDtoList(IEnumerable<GenericParam>? parameters) =>
		[.. (parameters ?? []).Select(ToDto)];

	public IList<GenericParam> FromDtoList(IEnumerable<GenericParamDto>? parameters) =>
		[.. (parameters ?? []).Select(FromDto)];

	GenericParamConstraintDto ToDto(GenericParamConstraint constraint) => new(
		context.Signatures.ToDtoRequired(constraint.Constraint?.ToTypeSig()),
		context.Attributes.ToDtoList(constraint.CustomAttributes),
		constraint.Constraint?.FullName ?? string.Empty);

	GenericParamConstraint FromDto(GenericParamConstraintDto dto) {
		var constraint = context.Module.UpdateRowId(new GenericParamConstraintUser(
			context.Signatures.FromDtoRequired(dto.Constraint).ToTypeDefOrRef()));
		foreach (var attribute in context.Attributes.FromDtoList(dto.CustomAttributes))
			constraint.CustomAttributes.Add(attribute);
		return constraint;
	}

	static string Display(GenericParam parameter) {
		var name = parameter.Name is { Length: > 0 } value ? value.String : "<<no-name>>";
		return $"gparam({parameter.Number}) {name}";
	}
}
