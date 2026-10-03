using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Converts a method's parameter rows to and from their DTOs.
/// </summary>
/// <remarks>
/// A parameter row exists for the name, the flags, a default value and the marshalling; the parameter's
/// type lives in the method signature instead, which is why a row and a parameter are matched by
/// <c>Sequence</c> and nothing here carries a type. Rows are not one-per-parameter: a parameter with no
/// name, no default and no marshalling needs none, so the list the dialog collected is what gets written.
/// </remarks>
public sealed class ParamDefCodec {
	readonly EditContext context;

	internal ParamDefCodec(EditContext context) => this.context = context;

	public ParamDefDto ToDto(ParamDef? parameter) => parameter is null
		? throw SignatureCodec.Invalid("A parameter is required.")
		: new ParamDefDto(
			parameter.Name?.String ?? string.Empty,
			parameter.Sequence,
			(int)parameter.Attributes,
			context.Constants.ToDto(parameter.Constant),
			context.MarshalTypes.ToDto(parameter.MarshalType),
			context.Attributes.ToDtoList(parameter.CustomAttributes),
			Display(parameter));

	public ParamDef FromDto(ParamDefDto? dto) {
		if (dto is null)
			throw SignatureCodec.Invalid("A parameter is required.");
		var parameter = context.Module.UpdateRowId(
			new ParamDefUser(dto.Name, (ushort)dto.Sequence, (ParamAttributes)dto.Attributes) {
				Constant = context.Constants.FromDto(dto.Constant),
				MarshalType = context.MarshalTypes.FromDto(dto.MarshalType),
			});
		foreach (var attribute in context.Attributes.FromDtoList(dto.CustomAttributes))
			parameter.CustomAttributes.Add(attribute);
		return parameter;
	}

	public IReadOnlyList<ParamDefDto> ToDtoList(IEnumerable<ParamDef>? parameters) =>
		[.. (parameters ?? []).Select(ToDto)];

	public IList<ParamDef> FromDtoList(IEnumerable<ParamDefDto>? parameters) =>
		[.. (parameters ?? []).Select(FromDto)];

	static string Display(ParamDef parameter) =>
		parameter.Name is { Length: > 0 } name ? name.String : $"param #{parameter.Sequence}";
}
