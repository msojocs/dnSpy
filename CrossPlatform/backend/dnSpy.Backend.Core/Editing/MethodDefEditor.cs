using dnlib.DotNet;
using dnlib.PE;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Reads and writes a method definition, ported from dnSpy's <c>MethodDefOptions</c>.
/// </summary>
/// <remarks>
/// A method's body is not part of this: dnSpy's dialog has no body field either, so a method created
/// here has none, and the body is filled in later through "Replace Method Body" or by editing the IL.
/// The parameter rows are rebuilt from the DTO and then <c>UpdateParameterTypes</c> is called, which is
/// what dnSpy does at the same point — the rows a parameter needs are what the dialog collected, not
/// what the signature implies, since a parameter without a name, a default or a marshalling needs no row.
/// </remarks>
public sealed class MethodDefEditor {
	readonly EditContext context;

	internal MethodDefEditor(EditContext context) => this.context = context;

	public MethodOptionsDto ToDto(MethodDef? method) => method is null
		? throw SignatureCodec.Invalid("A method is required.")
		: new MethodOptionsDto(
			(int)method.ImplAttributes,
			(int)method.Attributes,
			(int)method.SemanticsAttributes,
			method.Name.String,
			method.MethodSig is { } signature ? context.Signatures.MethodToDto(signature) : null,
			context.ImplMaps.ToDto(method.ImplMap),
			context.Attributes.ToDtoList(method.CustomAttributes),
			context.DeclSecurities.ToDtoList(method.DeclSecurities),
			context.ParamDefs.ToDtoList(method.ParamDefs),
			context.GenericParams.ToDtoList(method.GenericParameters),
			context.MethodOverrides.ToDtoList(method.Overrides),
			(uint)method.RVA,
			method.DeclaringType?.GenericParameters.Count ?? 0);

	/// <summary>Adds a method to the module, row id and all, without putting it in any type yet.</summary>
	public MethodDef Create(MethodOptionsDto dto) =>
		context.Module.UpdateRowId(CopyTo(new MethodDefUser(), dto));

	public MethodDef CopyTo(MethodDef method, MethodOptionsDto dto) {
		method.ImplAttributes = (MethodImplAttributes)dto.ImplAttributes;
		method.Attributes = (MethodAttributes)dto.Attributes;
		method.SemanticsAttributes = (MethodSemanticsAttributes)dto.SemanticsAttributes;
		method.RVA = (RVA)dto.Rva;
		method.Name = dto.Name;
		method.MethodSig = dto.MethodSig is null ? null : context.Signatures.MethodFromDto(dto.MethodSig);
		method.ImplMap = context.ImplMaps.FromDto(dto.ImplMap);

		method.CustomAttributes.Clear();
		foreach (var attribute in context.Attributes.FromDtoList(dto.CustomAttributes))
			method.CustomAttributes.Add(attribute);
		method.DeclSecurities.Clear();
		foreach (var security in context.DeclSecurities.FromDtoList(dto.DeclSecurities))
			method.DeclSecurities.Add(security);
		method.ParamDefs.Clear();
		foreach (var parameter in context.ParamDefs.FromDtoList(dto.ParamDefs))
			method.ParamDefs.Add(parameter);
		method.GenericParameters.Clear();
		foreach (var parameter in context.GenericParams.FromDtoList(dto.GenericParameters))
			method.GenericParameters.Add(parameter);
		method.Overrides.Clear();
		foreach (var @override in context.MethodOverrides.FromDtoList(dto.Overrides, method))
			method.Overrides.Add(@override);

		method.Parameters.UpdateParameterTypes();
		return method;
	}
}
