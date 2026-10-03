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

	/// <summary>
	/// An override with no body of its own belongs to <paramref name="method"/>: dnSpy's
	/// <c>MethodDefOptions.CopyTo</c> fills a body-less override in with the method being edited, which is
	/// what lets a dialog add an override without knowing the token the method will end up with.
	/// </summary>
	public MethodOverride FromDto(MethodOverrideDto? dto, MethodDef method) => dto is null
		? throw SignatureCodec.Invalid("A method override is required.")
		: new MethodOverride(
			dto.MethodBody is null ? method : context.MethodRefs.FromDtoMethod(dto.MethodBody),
			context.MethodRefs.FromDtoMethod(dto.MethodDeclaration));

	public IReadOnlyList<MethodOverrideDto> ToDtoList(IEnumerable<MethodOverride>? overrides) =>
		[.. (overrides ?? []).Select(ToDto)];

	public IList<MethodOverride> FromDtoList(IEnumerable<MethodOverrideDto>? overrides, MethodDef method) =>
		[.. (overrides ?? []).Select(dto => FromDto(dto, method))];

	/// <summary>
	/// What the row shows, which is the declaration and nothing else: dnSpy's `MethodOverrideVM.FullName`
	/// is `MethodDeclaration.ToString()`, so an override whose body changed reads the same.
	/// </summary>
	static string Display(MethodOverride value) => value.MethodDeclaration.FullName;
}
