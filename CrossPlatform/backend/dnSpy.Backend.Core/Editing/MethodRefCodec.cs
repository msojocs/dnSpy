using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Converts a reference to a method — a custom attribute's constructor, a method override's two halves —
/// to and from its DTO.
/// </summary>
/// <remarks>
/// A reference is written as the declaring type, the name and the signature, which together are what
/// metadata stores for a <c>MemberRef</c> and what identifies a <c>MethodDef</c> within its type. A
/// method the edited module already defines is used directly, so a custom attribute on a new type can
/// point at a constructor in the same module without a redundant <c>MemberRef</c> row; anything else
/// becomes a <c>MemberRef</c>.
/// </remarks>
public sealed class MethodRefCodec {
	readonly EditContext context;

	internal MethodRefCodec(EditContext context) => this.context = context;

	/// <summary>
	/// Describes a method reference. The parameter is the widest interface the callers hold — a custom
	/// attribute's constructor is an <c>ICustomAttributeType</c>, which is not an <c>IMethodDefOrRef</c>
	/// even though every implementation of it is one of the two shapes handled here.
	/// </summary>
	public MethodRefDto ToDto(IMethod? method) => method switch {
		null => throw SignatureCodec.Invalid("A method reference is required."),
		MethodDef def => new MethodRefDto(
			context.Signatures.ToDto(def.DeclaringType),
			def.Name.String,
			context.Signatures.MethodToDto(def.MethodSig),
			Display(def)),
		MemberRef reference => new MethodRefDto(
			context.Signatures.ToDto(reference.DeclaringType),
			reference.Name.String,
			context.Signatures.MethodToDto((MethodSig)reference.Signature),
			Display(reference)),
		_ => throw SignatureCodec.Invalid($"A '{method.GetType().Name}' cannot be used as a method reference."),
	};

	/// <summary>
	/// Rebuilds a method reference. When the declaring type is a type this module defines and the name
	/// and signature match one of its methods, that method is returned — a custom attribute pointing at
	/// its own module's constructor needs no <c>MemberRef</c>. Otherwise a <c>MemberRef</c> is built and
	/// imported, which also creates the <c>TypeRef</c> and <c>AssemblyRef</c> rows it needs.
	/// </summary>
	public ICustomAttributeType FromDto(MethodRefDto? dto) => FromDtoMember(dto) as ICustomAttributeType
		?? throw SignatureCodec.Invalid("A custom attribute needs a constructor.");

	/// <summary>Rebuilds a method reference for a place that does not need a custom-attribute constructor.</summary>
	public IMethodDefOrRef FromDtoMethod(MethodRefDto? dto) => dto is null
		? throw SignatureCodec.Invalid("A method reference is required.")
		: FromDtoMember(dto);

	IMethodDefOrRef FromDtoMember(MethodRefDto? dto) {
		if (dto is null)
			throw SignatureCodec.Invalid("A method reference is required.");
		var signature = context.Signatures.MethodFromDto(dto.Signature);
		// A node id or a name that resolves inside this module gives back the method definition itself;
		// dnlib only keeps a MemberRef for something outside, which is exactly what the importer decides.
		if (dto.DeclaringType.Type is { } reference && FindLocal(reference, dto.Name, signature) is { } definition)
			return definition;
		var declaringType = context.Signatures.FromDtoRequired(dto.DeclaringType).ToTypeDefOrRef();
		var memberRef = new MemberRefUser(context.Module, dto.Name, signature, declaringType);
		return context.Types.Import(memberRef);
	}

	MethodDef? FindLocal(TypeRefDto reference, string name, MethodSig signature) {
		if (!context.Types.IsDefinedLocally(reference))
			return null;
		var type = context.Types.Resolve(reference).ResolveTypeDef();
		if (type is null)
			return null;
		var comparer = new SigComparer();
		return type.Methods.FirstOrDefault(method =>
			method.Name.String == name &&
			method.MethodSig is not null &&
			comparer.Equals(method.MethodSig, signature));
	}

	static string Display(MethodDef method) => method.FullName;
	static string Display(MemberRef reference) => reference.FullName;
}
