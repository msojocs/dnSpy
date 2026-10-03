using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Converts the type-signature trees the dialogs edit to and from dnlib's <see cref="TypeSig"/>.
/// </summary>
/// <remarks>
/// The DTO covers everything dnSpy's <c>TypeSigCreator</c> can assemble, which is the whole of dnlib's
/// type-signature model apart from the metadata-only forms — <c>Sentinel</c>, <c>Internal</c>,
/// <c>ValueArray</c>, <c>Module</c> — that neither the creator nor any dialog can build, and that no
/// compiler emits for a field, parameter or return type. A signature that uses one of those is reported
/// rather than silently flattened, since the alternative would be writing back something different from
/// what was read.
/// </remarks>
public sealed class SignatureCodec {
	readonly EditContext context;

	internal SignatureCodec(EditContext context) => this.context = context;

	// ---------------------------------------------------------------------------------------------
	// Type signatures
	// ---------------------------------------------------------------------------------------------

	/// <summary>A type reference as a signature tree: the <c>type</c> form, which is what a type name
	/// also has to be when it is only ever used as a reference, such as a base type or an interface.</summary>
	/// <remarks>
	/// A <c>TypeSpec</c> has no name of its own — it is metadata's way of writing a signature in a slot
	/// that holds a type — so its signature is described instead, which is what keeps a reference to
	/// something like <c>List&lt;int&gt;.Add</c> intact rather than flattening it to an anonymous type.
	/// </remarks>
	public TypeSigDto ToDto(ITypeDefOrRef reference) =>
		reference is TypeSpec specification ? Describe(specification.TypeSig) : DescribeNamed(reference);

	TypeSigDto DescribeNamed(ITypeDefOrRef reference) => new(
		TypeSigKinds.Type,
		Type: TypeOf(reference),
		ValueType: reference.IsValueType,
		Display: reference.FullName);

	public TypeSigDto? ToDto(TypeSig? signature) => signature is null ? null : Describe(signature);

	public TypeSigDto ToDtoRequired(TypeSig? signature) =>
		signature is null ? throw Invalid("A type is required.") : Describe(signature);

	public TypeSig? FromDto(TypeSigDto? dto) => dto is null ? null : Build(dto);

	public TypeSig FromDtoRequired(TypeSigDto? dto) => dto is null ? throw Invalid("A type is required.") : Build(dto);

	TypeSigDto Describe(TypeSig signature) => signature switch {
		CorLibTypeSig corLib when CorLibNameOf(corLib.ElementType) is { } name => new TypeSigDto(
			TypeSigKinds.Type,
			Type: new TypeRefDto(CorLibScope, "System", name),
			ValueType: CorLibValueTypes.Contains(corLib.ElementType),
			Display: signature.FullName),
		GenericInstSig generic when generic.GenericType is not null => new TypeSigDto(
			TypeSigKinds.GenericInst,
			Type: Describe(generic.GenericType).Type,
			ValueType: generic.IsValueType,
			Arguments: [.. generic.GenericArguments.Select(Describe)],
			Display: signature.FullName),
		SZArraySig szArray => new TypeSigDto(
			TypeSigKinds.SzArray,
			Element: Describe(szArray.Next),
			Display: signature.FullName),
		ArraySig array => new TypeSigDto(
			TypeSigKinds.Array,
			Element: Describe(array.Next),
			Rank: (int)array.Rank,
			Sizes: [.. array.Sizes.Select(size => (int)size)],
			LowerBounds: [.. array.LowerBounds],
			Display: signature.FullName),
		PinnedSig pinned => new TypeSigDto(TypeSigKinds.Pinned, Element: Describe(pinned.Next), Display: signature.FullName),
		PtrSig pointer => new TypeSigDto(TypeSigKinds.Pointer, Element: Describe(pointer.Next), Display: signature.FullName),
		ByRefSig byRef => new TypeSigDto(TypeSigKinds.ByRef, Element: Describe(byRef.Next), Display: signature.FullName),
		CModReqdSig required => new TypeSigDto(
			TypeSigKinds.CModReqd,
			Element: Describe(required.Next),
			Modifier: ToDto(required.Modifier),
			Display: signature.FullName),
		CModOptSig optional => new TypeSigDto(
			TypeSigKinds.CModOpt,
			Element: Describe(optional.Next),
			Modifier: ToDto(optional.Modifier),
			Display: signature.FullName),
		GenericVar genericVar => new TypeSigDto(
			TypeSigKinds.GenericVar,
			GenericParameterNumber: (int)genericVar.Number,
			Display: signature.FullName),
		GenericMVar genericMVar => new TypeSigDto(
			TypeSigKinds.GenericMVar,
			GenericParameterNumber: (int)genericMVar.Number,
			Display: signature.FullName),
		FnPtrSig functionPointer => new TypeSigDto(
			TypeSigKinds.FnPtr,
			FunctionPointer: functionPointer.Signature is MethodSig called ? MethodToDto(called) : null,
			Display: signature.FullName),
		TypeDefOrRefSig named => new TypeSigDto(
			TypeSigKinds.Type,
			Type: TypeOf(named.TypeDefOrRef),
			ValueType: signature.IsValueType,
			Display: signature.FullName),
		_ => throw Invalid($"A '{signature.ElementType}' signature cannot be edited."),
	};

	TypeSig Build(TypeSigDto dto) => dto.Kind switch {
		TypeSigKinds.Type => BuildNamed(dto),
		TypeSigKinds.GenericInst => BuildGenericInstance(dto),
		TypeSigKinds.SzArray => new SZArraySig(FromDtoRequired(dto.Element)),
		TypeSigKinds.Array => new ArraySig(
			FromDtoRequired(dto.Element),
			(uint)dto.Rank,
			(dto.Sizes ?? []).Select(size => (uint)size),
			dto.LowerBounds ?? []),
		TypeSigKinds.Pinned => new PinnedSig(FromDtoRequired(dto.Element)),
		TypeSigKinds.Pointer => new PtrSig(FromDtoRequired(dto.Element)),
		TypeSigKinds.ByRef => new ByRefSig(FromDtoRequired(dto.Element)),
		TypeSigKinds.CModReqd => new CModReqdSig(ModifierOf(dto), FromDtoRequired(dto.Element)),
		TypeSigKinds.CModOpt => new CModOptSig(ModifierOf(dto), FromDtoRequired(dto.Element)),
		TypeSigKinds.GenericVar => new GenericVar((uint)dto.GenericParameterNumber),
		TypeSigKinds.GenericMVar => new GenericMVar((uint)dto.GenericParameterNumber),
		TypeSigKinds.FnPtr => new FnPtrSig(MethodFromDto(dto.FunctionPointer)),
		TypeSigKinds.Empty => throw Invalid("A type is required."),
		_ => throw Invalid($"Unknown type signature kind '{dto.Kind}'."),
	};

	/// <summary>
	/// Whether a named signature is a value type. A DTO that was read says so itself; one a dialog
	/// assembled from a picked name usually does not, and then the definition decides — which is what
	/// makes a struct come back as the struct it is rather than as a class. A type that resolves to
	/// nothing has only the DTO to go on.
	/// </summary>
	static bool IsValueType(TypeSigDto dto, ITypeDefOrRef definition) =>
		dto.ValueType ?? definition.ResolveTypeDef()?.IsValueType ?? false;

	TypeSig BuildNamed(TypeSigDto dto) {
		var reference = dto.Type ?? throw Invalid("A type signature needs a type.");
		// A primitive is a shared corlib singleton rather than a reference to a type definition, so it has
		// to be recognized by name — that is what dnSpy's picker hands back for System.Int32 and friends,
		// and what keeps a rebuilt signature identical to the one that was read.
		if (reference.Namespace == "System" && CorLibElementType(reference.Name) is { } element && !context.Types.IsDefinedLocally(reference))
			return CorLibSig(element);
		// `System.Type` is not one of the primitives `CorLibTypes` exposes as a signature, so a dialog
		// that names it by hand — which is what a type-valued custom attribute argument is — is answered
		// with the corlib's own reference, the same one dnSpy's `CANamedArgumentVM` builds for it.
		if (reference.Namespace == "System" && reference.Name == "Type" && !context.Types.IsDefinedLocally(reference))
			return new ClassSig(context.Module.CorLibTypes.GetTypeRef("System", "Type"));
		var definition = context.Types.Resolve(reference);
		return IsValueType(dto, definition) ? new ValueTypeSig(definition) : new ClassSig(definition);
	}

	TypeSig BuildGenericInstance(TypeSigDto dto) {
		var reference = dto.Type ?? throw Invalid("A generic instance needs a type.");
		var definition = context.Types.Resolve(reference);
		return new GenericInstSig(
			IsValueType(dto, definition) ? new ValueTypeSig(definition) : new ClassSig(definition),
			[.. (dto.Arguments ?? []).Select(FromDtoRequired)]);
	}

	ITypeDefOrRef ModifierOf(TypeSigDto dto) =>
		dto.Modifier?.Type is { } reference
			? context.Types.Resolve(reference)
			: FromDtoRequired(dto.Modifier).ToTypeDefOrRef();

	/// <summary>A reference to a named type, described by its scope, namespace and nested name.</summary>
	public TypeRefDto TypeOf(ITypeDefOrRef reference) {
		if (reference is TypeSpec)
			throw Invalid("A type specification has no name to be referenced by.");
		// A nested type is named the way a TypeRef names it: the outermost declaring type carries the
		// scope, and the nested path is written with '/' because that is how dnlib spells that name. Only
		// the outermost type has a namespace — a nested one answers with null — so the walk outwards is
		// also what finds the namespace the name needs.
		var name = reference.Name;
		var ns = reference.Namespace ?? string.Empty;
		var scope = reference;
		while (scope.DeclaringType is { } declaring) {
			name = declaring.Name + "/" + name;
			if (ns.Length == 0)
				ns = declaring.Namespace ?? string.Empty;
			scope = declaring;
		}
		return new TypeRefDto(ScopeName(scope), ns, name);
	}

	/// <summary>
	/// The assembly a type is written against: empty for a type this module defines, otherwise the simple
	/// name of the assembly it comes from. A type in another module of the same assembly resolves to that
	/// assembly, which is the closest a single scope name can come to a module reference.
	/// </summary>
	static string ScopeName(ITypeDefOrRef type) => type switch {
		TypeDef def => AssemblyNameOf(def.Module),
		TypeRef typeRef => typeRef.ResolutionScope switch {
			AssemblyRef assembly => assembly.Name.String,
			TypeRef outer => ScopeName(outer),
			ModuleDef owner => AssemblyNameOf(owner),
			ModuleRef moduleRef => moduleRef.Name.String,
			_ => string.Empty,
		},
		_ => string.Empty,
	};

	static string AssemblyNameOf(ModuleDef module) =>
		module.Assembly?.Name.String ?? module.Name.String;

	// ---------------------------------------------------------------------------------------------
	// Method and property signatures
	// ---------------------------------------------------------------------------------------------

	public MethodSigDto MethodToDto(MethodSig? signature) => signature is null
		? throw Invalid("A method signature is required.")
		: new MethodSigDto(
			(int)signature.CallingConvention,
			ToDtoRequired(signature.RetType),
			[.. signature.Params.Select(ToDtoRequired)],
			signature.ParamsAfterSentinel is { Count: > 0 } ? [.. signature.ParamsAfterSentinel.Select(ToDtoRequired)] : null,
			(int)signature.GenParamCount,
			DnlibDisplay.Method(signature));

	public MethodSig MethodFromDto(MethodSigDto? dto) {
		var signature = dto ?? throw Invalid("A method signature is required.");
		var result = new MethodSig { CallingConvention = (CallingConvention)signature.CallingConvention };
		result.RetType = FromDtoRequired(signature.ReturnType);
		foreach (var parameter in signature.Parameters ?? [])
			result.Params.Add(FromDtoRequired(parameter));
		result.GenParamCount = (uint)signature.GenericParameterCount;
		if (signature.VarArgParameters is { Count: > 0 })
			result.ParamsAfterSentinel = [.. signature.VarArgParameters.Select(FromDtoRequired)];
		return result;
	}

	public PropertySigDto PropertyToDto(PropertySig? signature) => signature is null
		? throw Invalid("A property signature is required.")
		: new PropertySigDto(
			signature.HasThis,
			ToDtoRequired(signature.RetType),
			[.. signature.Params.Select(ToDtoRequired)],
			DnlibDisplay.Method(signature));

	public PropertySig PropertyFromDto(PropertySigDto? dto) {
		var signature = dto ?? throw Invalid("A property signature is required.");
		var result = new PropertySig(signature.HasThis);
		result.RetType = FromDtoRequired(signature.PropertyType);
		foreach (var parameter in signature.Parameters ?? [])
			result.Params.Add(FromDtoRequired(parameter));
		return result;
	}

	// ---------------------------------------------------------------------------------------------
	// Corlib primitives
	// ---------------------------------------------------------------------------------------------

	/// <summary>
	/// The primitives the corlib defines, in the order dnlib's <c>CorLibTypes</c> exposes them. These are
	/// the only types that get a shared signature object instead of a reference to a type definition.
	/// </summary>
	static readonly (ElementType Element, string Name)[] CorLibNames = [
		(ElementType.Void, "Void"),
		(ElementType.Boolean, "Boolean"),
		(ElementType.Char, "Char"),
		(ElementType.I1, "SByte"),
		(ElementType.U1, "Byte"),
		(ElementType.I2, "Int16"),
		(ElementType.U2, "UInt16"),
		(ElementType.I4, "Int32"),
		(ElementType.U4, "UInt32"),
		(ElementType.I8, "Int64"),
		(ElementType.U8, "UInt64"),
		(ElementType.R4, "Single"),
		(ElementType.R8, "Double"),
		(ElementType.String, "String"),
		(ElementType.TypedByRef, "TypedReference"),
		(ElementType.I, "IntPtr"),
		(ElementType.U, "UIntPtr"),
		(ElementType.Object, "Object"),
	];

	/// <summary>
	/// Which of those primitives are value types. Read from a fixed list rather than from dnlib, so that
	/// what a dialog shows and what it writes back agree without depending on how dnlib happens to answer
	/// <c>IsValueType</c> for a signature that has no type definition behind it.
	/// </summary>
	static readonly HashSet<ElementType> CorLibValueTypes = [
		ElementType.Boolean, ElementType.Char,
		ElementType.I1, ElementType.U1, ElementType.I2, ElementType.U2,
		ElementType.I4, ElementType.U4, ElementType.I8, ElementType.U8,
		ElementType.R4, ElementType.R8,
		ElementType.I, ElementType.U, ElementType.TypedByRef,
	];

	/// <summary>The scope every corlib type signature this module reads or writes is described with,
	/// which is also what tells a signature that came from the corlib from one that did not.</summary>
	public string CorLibScope => context.Module.CorLibTypes.AssemblyRef?.Name.String ?? "mscorlib";

	static string? CorLibNameOf(ElementType element) =>
		CorLibNames.FirstOrDefault(entry => entry.Element == element).Name;

	static ElementType? CorLibElementType(string name) {
		foreach (var entry in CorLibNames)
			if (entry.Name == name)
				return entry.Element;
		return null;
	}

	TypeSig CorLibSig(ElementType element) => element switch {
		ElementType.Void => context.Module.CorLibTypes.Void,
		ElementType.Boolean => context.Module.CorLibTypes.Boolean,
		ElementType.Char => context.Module.CorLibTypes.Char,
		ElementType.I1 => context.Module.CorLibTypes.SByte,
		ElementType.U1 => context.Module.CorLibTypes.Byte,
		ElementType.I2 => context.Module.CorLibTypes.Int16,
		ElementType.U2 => context.Module.CorLibTypes.UInt16,
		ElementType.I4 => context.Module.CorLibTypes.Int32,
		ElementType.U4 => context.Module.CorLibTypes.UInt32,
		ElementType.I8 => context.Module.CorLibTypes.Int64,
		ElementType.U8 => context.Module.CorLibTypes.UInt64,
		ElementType.R4 => context.Module.CorLibTypes.Single,
		ElementType.R8 => context.Module.CorLibTypes.Double,
		ElementType.String => context.Module.CorLibTypes.String,
		ElementType.TypedByRef => context.Module.CorLibTypes.TypedReference,
		ElementType.I => context.Module.CorLibTypes.IntPtr,
		ElementType.U => context.Module.CorLibTypes.UIntPtr,
		_ => context.Module.CorLibTypes.Object,
	};

	internal static RpcException Invalid(string message) => new(ErrorCodes.EditValidationFailed, message);
}
