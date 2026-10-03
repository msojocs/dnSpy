using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Turns the way a dialog describes a type — an assembly, a namespace, a name, plus the explorer node it
/// was picked from — into a reference the module being edited can store.
/// </summary>
/// <remarks>
/// Four sources are tried in order. The WPF client only ever needs the first, because its dialogs hand
/// the codecs the object the picker returned; the rest exist because a value that came back over the
/// wire may name a type this process has never had to resolve before:
/// <list type="number">
/// <item>the node id, since the workspace has already resolved that type — including one that lives in a
/// referenced assembly the workspace has not loaded as a module at all;</item>
/// <item>a definition in the module being edited, used as it stands;</item>
/// <item>a definition in another module the workspace has open, imported so this module gains the
/// <c>TypeRef</c> and <c>AssemblyRef</c> rows the reference needs;</item>
/// <item>otherwise a bare reference, which is all a name on its own can express.</item>
/// </list>
/// </remarks>
public sealed class TypeResolver {
	readonly ModuleDef module;
	readonly IReadOnlyList<ModuleDef> modules;
	readonly Func<string, ITypeDefOrRef?>? byNodeId;
	readonly Importer importer;

	/// <param name="module">The module every resolved reference is imported into.</param>
	/// <param name="modules">Modules a bare name may be looked up in; the edited module is always searched.</param>
	/// <param name="byNodeId">Resolves an explorer node id, when the caller can see the workspace.</param>
	public TypeResolver(ModuleDef module, IReadOnlyList<ModuleDef>? modules = null, Func<string, ITypeDefOrRef?>? byNodeId = null) {
		this.module = module;
		this.byNodeId = byNodeId;
		var candidates = new List<ModuleDef> { module };
		if (modules is not null)
			foreach (var candidate in modules)
				if (!ReferenceEquals(candidate, module))
					candidates.Add(candidate);
		this.modules = candidates;
		// One importer for the lifetime of the edit: it caches the rows it creates, so reusing it is what
		// keeps a dialog that references the same assembly twice from adding two AssemblyRef rows for it.
		importer = new Importer(module, ImporterOptions.TryToUseDefs | ImporterOptions.TryToUseExistingAssemblyRefs);
	}

	/// <summary>The module being edited: where new rows go, and where every name is resolved from.</summary>
	public ModuleDef Module => module;

	/// <summary>Brings a type reference from anywhere into this module, reusing it when it is already here.</summary>
	public ITypeDefOrRef Import(ITypeDefOrRef reference) => IsDefinedLocally(reference) ? reference : importer.Import(reference);

	/// <summary>Brings a method reference from anywhere into this module, reusing it when it is already here.</summary>
	public IMethodDefOrRef Import(IMethodDefOrRef method) => method switch {
		MethodDef def when def.Module == module => def,
		MemberRef reference when reference.Module == module => reference,
		// Import answers with IMethod because it does not know whether a method or a field was asked for,
		// but a method reference always comes back as one of the two shapes above.
		MethodDef def => (IMethodDefOrRef)importer.Import(def),
		MemberRef reference => importer.Import(reference),
		_ => method,
	};

	/// <summary>Resolves a described type, or throws when it names nothing that can be written.</summary>
	public ITypeDefOrRef Resolve(TypeRefDto reference) {
		if (reference.NodeId is { Length: > 0 } nodeId && byNodeId?.Invoke(nodeId) is { } picked)
			return Import(picked);
		foreach (var candidate in modules)
			if (Find(candidate, reference) is { } found)
				return Import(found);
		if (reference.Scope.Length == 0)
			throw new RpcException(ErrorCodes.EditValidationFailed, $"The type '{FullNameOf(reference)}' is not defined in this module.");
		// Nothing has the assembly loaded, so the name is all there is. Handing the importer a reference
		// whose scope is that assembly is what makes it add the AssemblyRef row this module needs.
		return importer.Import(new TypeRefUser(module, reference.Namespace, reference.Name, new AssemblyRefUser(reference.Scope)));
	}

	/// <summary>Whether the module being edited defines this type itself, rather than referring to it.</summary>
	public bool IsDefinedLocally(TypeRefDto reference) => Find(module, reference) is not null;

	/// <summary>The name a described type is shown under: the namespace, then the nested path.</summary>
	public static string FullNameOf(TypeRefDto reference) =>
		reference.Namespace.Length == 0 ? reference.Name : reference.Namespace + "." + reference.Name;

	bool IsDefinedLocally(ITypeDefOrRef reference) => reference switch {
		TypeDef def => def.Module == module,
		TypeRef typeRef => typeRef.Module == module,
		TypeSpec spec => spec.Module == module,
		_ => false,
	};

	/// <summary>
	/// Looks a described type up in one module. The name is a metadata name, so a nested type's path is
	/// separated by <c>/</c> — dnlib writes full names that way, and it is what keeps a nested type from
	/// colliding with a top-level one of the same leaf name.
	/// </summary>
	static ITypeDefOrRef? Find(ModuleDef candidate, TypeRefDto reference) {
		var segments = reference.Name.Split('/');
		if (segments.Length == 0 || segments[0].Length == 0)
			return null;
		ITypeDefOrRef? current = candidate.Types.FirstOrDefault(type =>
			type.Name.String == segments[0] && type.Namespace.String == reference.Namespace);
		for (var i = 1; current is not null && i < segments.Length; i++) {
			var name = segments[i];
			current = current.ResolveTypeDef()?.NestedTypes.FirstOrDefault(type => type.Name.String == name);
		}
		return current;
	}
}
