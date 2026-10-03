using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Builds the model a create- or edit-dialog opens with: what the node being edited already holds, or the
/// defaults dnSpy starts a new one from.
/// </summary>
/// <remarks>
/// One class for both because dnSpy has one dialog for both — a delete or a rename is a different command,
/// but creating a method and editing one are the same form with a different title and a different starting
/// value. The defaults are settled here rather than in the client, and they are taken from the create
/// commands of the WPF extension (<c>CreateMethodCommand</c>, <c>CreateFieldCommand</c> and the rest):
/// the signature a new method needs so that it is legal in an interface or a static class, and the literal
/// field an enum needs so that its underlying type is reachable from it.
/// </remarks>
public sealed class NodeOptionsFactory {
	const string DefaultTypeName = "MyType";
	const string DefaultMethodName = "MyMethod";
	const string DefaultFieldName = "MyField";
	const string DefaultPropertyName = "MyProperty";
	const string DefaultEventName = "MyEvent";
	const string EnumValueFieldName = "value__";

	readonly EditContext context;

	internal NodeOptionsFactory(EditContext context) => this.context = context;

	/// <summary>The values the node being edited holds, in the shape its dialog edits them.</summary>
	public NodeOptionsDto Existing(IMDTokenProvider target) => target switch {
		TypeDef type => NodeOptionsDto.OfType(context.TypeDefs.ToDto(type)),
		MethodDef method => NodeOptionsDto.OfMethod(context.MethodDefs.ToDto(method)),
		FieldDef field => NodeOptionsDto.OfField(context.FieldDefs.ToDto(field)),
		PropertyDef property => NodeOptionsDto.OfProperty(context.PropertyDefs.ToDto(property)),
		EventDef @event => NodeOptionsDto.OfEvent(context.EventDefs.ToDto(@event)),
		_ => throw SignatureCodec.Invalid("The selected item cannot be edited."),
	};

	/// <param name="namespace">The namespace the type goes into. A nested type has none of its own, so
	/// this is empty for one.</param>
	/// <param name="isNested">Whether it is created inside another type, which its visibility is the only
	/// trace of: a nested type is <c>NestedPublic</c> where a top-level one is <c>Public</c>.</param>
	public NodeOptionsDto NewType(string @namespace, bool isNested) => NodeOptionsDto.OfType(new TypeOptionsDto(
		(int)((isNested ? TypeAttributes.NestedPublic : TypeAttributes.Public) |
			TypeAttributes.AutoLayout | TypeAttributes.Class | TypeAttributes.AnsiClass),
		@namespace,
		DefaultTypeName,
		null,
		null,
		context.Signatures.ToDto(context.Module.CorLibTypes.Object.TypeDefOrRef),
		[],
		[],
		[],
		[]));

	/// <summary>A method of <paramref name="owner"/>. A static class has no instance to be called on, so
	/// its member starts out static; an interface's starts out abstract, which is the only kind of method
	/// it can hold.</summary>
	public NodeOptionsDto NewMethod(TypeDef owner) {
		var isInstance = !(owner.IsAbstract && owner.IsSealed);
		var signature = isInstance
			? MethodSig.CreateInstance(context.Module.CorLibTypes.Void)
			: MethodSig.CreateStatic(context.Module.CorLibTypes.Void);
		var attributes = MethodAttributes.Public | MethodAttributes.ReuseSlot | MethodAttributes.HideBySig;
		if (!isInstance)
			attributes |= MethodAttributes.Static;
		if (owner.IsInterface)
			attributes |= MethodAttributes.Abstract | MethodAttributes.Virtual | MethodAttributes.NewSlot;
		return NodeOptionsDto.OfMethod(new MethodOptionsDto(
			(int)(MethodImplAttributes.IL | MethodImplAttributes.Managed),
			(int)attributes,
			0,
			DefaultMethodName,
			context.Signatures.MethodToDto(signature),
			null,
			[],
			[],
			[],
			[],
			[],
			OwnerGenericParameterCount: owner.GenericParameters.Count));
	}

	/// <summary>
	/// A field of <paramref name="owner"/>. An enum's own field is a literal whose value is the zero of the
	/// enum's underlying type, and an enum that has no underlying type it can find is the special
	/// <c>value__</c> field instead — both are what dnSpy's create command produces.
	/// </summary>
	public NodeOptionsDto NewField(TypeDef owner) {
		var name = DefaultFieldName;
		var attributes = FieldAttributes.Public;
		TypeSig signature = context.Module.CorLibTypes.Int32;
		ConstantDto? constant = null;
		if (owner.IsEnum) {
			if (owner.GetEnumUnderlyingType() is { } underlying) {
				var element = underlying.RemovePinnedAndModifiers().GetElementType();
				signature = new ValueTypeSig(owner);
				constant = new ConstantDto((int)element, DnlibDisplay.LiteralText(DnlibDisplay.DefaultValue(element)));
				attributes |= FieldAttributes.Literal | FieldAttributes.Static | FieldAttributes.HasDefault;
			}
			else {
				name = EnumValueFieldName;
				attributes |= FieldAttributes.SpecialName | FieldAttributes.RTSpecialName;
			}
		}
		else if (owner.IsAbstract && owner.IsSealed)
			attributes |= FieldAttributes.Static;
		return NodeOptionsDto.OfField(new FieldOptionsDto(
			(int)attributes,
			name,
			context.Signatures.ToDtoRequired(signature),
			null,
			null,
			null,
			null,
			constant,
			[],
			OwnerGenericParameterCount: owner.GenericParameters.Count));
	}

	public NodeOptionsDto NewProperty(TypeDef owner) {
		var isInstance = !(owner.IsAbstract && owner.IsSealed);
		var signature = isInstance
			? PropertySig.CreateInstance(context.Module.CorLibTypes.Int32)
			: PropertySig.CreateStatic(context.Module.CorLibTypes.Int32);
		return NodeOptionsDto.OfProperty(new PropertyOptionsDto(
			0,
			DefaultPropertyName,
			context.Signatures.PropertyToDto(signature),
			null,
			[],
			[],
			[],
			[],
			OwnerGenericParameterCount: owner.GenericParameters.Count));
	}

	/// <summary>An event of an <c>EventHandler</c> type, which is the type a new one starts with whatever
	/// its owner is. A new event has no accessors: dnSpy's dialog adds those, and a method that has not
	/// been marked as an accessor must not be one.</summary>
	public NodeOptionsDto NewEvent(TypeDef owner) => NodeOptionsDto.OfEvent(new EventOptionsDto(
		0,
		DefaultEventName,
		context.Signatures.ToDto(context.Module.CorLibTypes.GetTypeRef("System", "EventHandler")),
		null,
		null,
		null,
		[],
		[],
		OwnerGenericParameterCount: owner.GenericParameters.Count));
}
