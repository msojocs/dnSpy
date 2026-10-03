using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Converts a P/Invoke row — the method or field it belongs to, the native library and the entry point
/// in it — to and from its DTO.
/// </summary>
/// <remarks>
/// The attribute flags travel as one raw integer rather than as the <c>CharSet</c>/<c>BestFit</c>/
/// <c>CallConv</c> pieces dnSpy's editor shows, because they are bit fields of different widths inside
/// the same word and the dialog is the only place that knows how to lay them out.
/// </remarks>
public sealed class ImplMapCodec {
	readonly EditContext context;

	internal ImplMapCodec(EditContext context) => this.context = context;

	public ImplMapDto? ToDto(ImplMap? implMap) => implMap is null
		? null
		: new ImplMapDto(
			(int)implMap.Attributes,
			implMap.Name.String,
			implMap.Module?.Name.String,
			Display(implMap));

	public ImplMap? FromDto(ImplMapDto? dto) {
		if (dto is null)
			return null;
		if (string.IsNullOrEmpty(dto.ModuleName))
			throw SignatureCodec.Invalid("A P/Invoke method needs the name of the native library it calls into.");
		// The native library is a row of its own, shared by every method that calls into it, so an
		// existing row is reused rather than a second one added for the same name.
		var moduleRef = context.Module.GetModuleRefs().FirstOrDefault(existing => existing.Name.String == dto.ModuleName)
			?? context.Module.UpdateRowId(new ModuleRefUser(context.Module, dto.ModuleName));
		return context.Module.UpdateRowId(new ImplMapUser(moduleRef, dto.Name, (PInvokeAttributes)dto.Attributes));
	}

	static string Display(ImplMap implMap) => $"{implMap.Name.String} in {implMap.Module?.Name.String}";
}
