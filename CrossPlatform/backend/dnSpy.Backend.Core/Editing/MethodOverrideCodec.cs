using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Converts a method's explicit overrides — the <c>MethodImpl</c> rows that say which method a body
/// implements — to and from their DTOs.
/// </summary>
/// <remarks>
/// dnlib models a row as a small value type rather than a class, so an override cannot be absent in the
/// way the other conversions here allow: the caller either has a row to convert or has nothing to call
/// with, and the list overloads are what make that distinction.
/// </remarks>
public sealed class MethodOverrideCodec {
	readonly EditContext context;

	internal MethodOverrideCodec(EditContext context) => this.context = context;

	public MethodOverrideDto ToDto(MethodOverride value) => new(
		context.MethodRefs.ToDto(value.MethodBody),
		context.MethodRefs.ToDto(value.MethodDeclaration),
		Display(value));

	public MethodOverride FromDto(MethodOverrideDto? dto) => dto is null
		? throw SignatureCodec.Invalid("A method override is required.")
		: new MethodOverride(
			context.MethodRefs.FromDtoMethod(dto.MethodBody),
			context.MethodRefs.FromDtoMethod(dto.MethodDeclaration));

	public IReadOnlyList<MethodOverrideDto> ToDtoList(IEnumerable<MethodOverride>? overrides) =>
		[.. (overrides ?? []).Select(ToDto)];

	public IList<MethodOverride> FromDtoList(IEnumerable<MethodOverrideDto>? overrides) =>
		[.. (overrides ?? []).Select(FromDto)];

	static string Display(MethodOverride value) =>
		$"{value.MethodBody.FullName} overrides {value.MethodDeclaration.FullName}";
}
