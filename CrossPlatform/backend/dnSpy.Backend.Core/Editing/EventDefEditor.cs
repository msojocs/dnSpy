using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Reads and writes an event definition, ported from dnSpy's <c>EventDefOptions</c>.
/// </summary>
/// <remarks>
/// The accessor marks are handled exactly as the property editor handles its own: add, remove and fire are
/// three separate methods rather than three lists, and each one loses its mark before any new accessor
/// gains one, so a method that changes role cannot end up with two marks. An event is created with no
/// accessors, which is what dnSpy does.
/// </remarks>
public sealed class EventDefEditor {
	readonly EditContext context;

	internal EventDefEditor(EditContext context) => this.context = context;

	public EventOptionsDto ToDto(EventDef? @event) => @event is null
		? throw SignatureCodec.Invalid("An event is required.")
		: new EventOptionsDto(
			(int)@event.Attributes,
			@event.Name.String,
			@event.EventType is { } eventType ? context.Signatures.ToDto(eventType) : null,
			context.Accessors.ToDto(@event.AddMethod),
			context.Accessors.ToDto(@event.InvokeMethod),
			context.Accessors.ToDto(@event.RemoveMethod),
			context.Accessors.ToDtoList(@event.OtherMethods),
			context.Attributes.ToDtoList(@event.CustomAttributes),
			@event.DeclaringType?.GenericParameters.Count ?? 0);

	/// <summary>Adds an event to the module, row id and all, without putting it in any type yet.</summary>
	public EventDef Create(TypeDef owner, EventOptionsDto dto) =>
		context.Module.UpdateRowId(CopyTo(new EventDefUser(), owner, dto));

	/// <param name="owner">The type the accessors are looked up in; an event cannot name a method of
	/// another type.</param>
	public EventDef CopyTo(EventDef @event, TypeDef owner, EventOptionsDto dto) {
		@event.Attributes = (EventAttributes)dto.Attributes;
		@event.Name = dto.Name;
		@event.EventType = dto.EventType is null
			? null
			: context.Signatures.FromDtoRequired(dto.EventType).ToTypeDefOrRef();

		if (@event.AddMethod is { } oldAdd)
			oldAdd.IsAddOn = false;
		if (@event.InvokeMethod is { } oldFire)
			oldFire.IsFire = false;
		if (@event.RemoveMethod is { } oldRemove)
			oldRemove.IsRemoveOn = false;
		foreach (var method in @event.OtherMethods)
			method.IsOther = false;

		var add = context.Accessors.FindOrNull(owner, dto.AddMethod);
		var fire = context.Accessors.FindOrNull(owner, dto.InvokeMethod);
		var remove = context.Accessors.FindOrNull(owner, dto.RemoveMethod);
		var others = context.Accessors.FindAll(owner, dto.OtherMethods);
		if (add is not null)
			add.IsAddOn = true;
		if (fire is not null)
			fire.IsFire = true;
		if (remove is not null)
			remove.IsRemoveOn = true;
		foreach (var method in others)
			method.IsOther = true;

		@event.AddMethod = add;
		@event.InvokeMethod = fire;
		@event.RemoveMethod = remove;
		@event.OtherMethods.Clear();
		foreach (var method in others)
			@event.OtherMethods.Add(method);

		@event.CustomAttributes.Clear();
		foreach (var attribute in context.Attributes.FromDtoList(dto.CustomAttributes))
			@event.CustomAttributes.Add(attribute);
		return @event;
	}
}
