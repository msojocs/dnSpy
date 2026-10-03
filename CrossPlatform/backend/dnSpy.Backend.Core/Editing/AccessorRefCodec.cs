using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Names the methods a property or an event is made of — its accessors — and finds them again, which is
/// what lets a dialog that only knows about explorer nodes speak about methods of the type being edited.
/// </summary>
/// <remarks>
/// Three ways in, in descending order of precision. A node id names exactly the row the user picked. A
/// token is what the model itself can always answer with, so a value that came back from <see cref="ToDto"/>
/// resolves without the workspace being consulted. A name is the last resort and is only accepted when the
/// type has exactly one method by that name: two methods of a type can share one, and picking either of
/// them silently would attach the wrong body to the property.
/// </remarks>
public sealed class AccessorRefCodec {
	readonly EditContext context;

	internal AccessorRefCodec(EditContext context) => this.context = context;

	/// <summary>Names a method, or nothing when there is no method — what a property with no setter has.</summary>
	public AccessorRefDto? ToDto(MethodDef? method) => method is null
		? null
		: new AccessorRefDto(method.Name.String, method.MDToken.Rid, null, method.FullName);

	public IReadOnlyList<AccessorRefDto> ToDtoList(IEnumerable<MethodDef>? methods) =>
		[.. (methods ?? []).Select(method => ToDto(method)!)];

	/// <summary>Finds the method a reference names, or null when the reference is absent.</summary>
	public MethodDef? FindOrNull(TypeDef owner, AccessorRefDto? reference) =>
		reference is null ? null : Find(owner, reference);

	/// <summary>Finds the method a reference names, or throws when it names nothing in this type.</summary>
	public MethodDef Find(TypeDef owner, AccessorRefDto reference) =>
		Resolve(owner, reference)
		?? throw SignatureCodec.Invalid($"'{reference.Name}' is not a method of '{owner.FullName}'.");

	public IList<MethodDef> FindAll(TypeDef owner, IEnumerable<AccessorRefDto>? references) =>
		[.. (references ?? []).Select(reference => Find(owner, reference))];

	MethodDef? Resolve(TypeDef owner, AccessorRefDto reference) {
		if (context.NodeOf<MethodDef>(reference.NodeId) is { } picked)
			return picked;
		if (reference.Token != 0)
			foreach (var method in owner.Methods)
				if (method.MDToken.Rid == reference.Token)
					return method;
		var named = owner.Methods.Where(method => method.Name.String == reference.Name).Take(2).ToArray();
		return named.Length == 1 ? named[0] : null;
	}
}
