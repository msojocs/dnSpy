using dnlib.DotNet;
using dnlib.DotNet.MD;
using dnSpy.Backend.Contracts;
using dnSpy.Backend.Core.Editing;
using Xunit;

namespace dnSpy.Backend.Tests.Editing;

/// <summary>
/// Checks that every field a dialog can show survives the trip out to the client and back. The failure
/// this guards against is silent: a field the conversion forgets reads back as its default, so an edit
/// the user made somewhere else in the dialog would quietly erase it.
/// </summary>
/// <remarks>
/// Each test asserts first that the outgoing DTO really carried the rows — otherwise a conversion that
/// dropped everything would still compare equal to itself — and then that the model rebuilt from that DTO
/// holds them too.
/// </remarks>
public sealed class NodeOptionsRoundTripTests {
	[Fact]
	public void TypeOptionsSurviveARoundTrip() {
		var (module, _) = EditTestModule.Create();
		var type = EditTestModule.AddType(module, "Ns", "Widget");
		type.BaseType = module.Types.First(candidate => candidate.Name == "Base");
		type.ClassLayout = module.UpdateRowId(new ClassLayoutUser(8, 64));
		type.CustomAttributes.Add(new CustomAttribute(EditTestModule.AddAttributeConstructor(module)));
		type.DeclSecurities.Add(module.UpdateRowId(new DeclSecurityUser(SecurityAction.Demand, [Security(module)])));
		type.GenericParameters.Add(module.UpdateRowId(new GenericParamUser(0, GenericParamAttributes.NonVariant, "T")));
		var iface = EditTestModule.AddType(module, "Ns", "IMarker");
		var implementation = module.UpdateRowId(new InterfaceImplUser(iface));
		implementation.CustomAttributes.Add(new CustomAttribute(EditTestModule.AddAttributeConstructor(module)));
		type.Interfaces.Add(implementation);

		var context = EditTestModule.Context(module, type);
		var dto = context.TypeDefs.ToDto(type);
		Assert.NotNull(dto.BaseType);
		Assert.Equal(8u, dto.PackingSize);
		Assert.Equal(64u, dto.ClassSize);
		Assert.Single(dto.CustomAttributes);
		Assert.Single(dto.DeclSecurities);
		Assert.Single(dto.DeclSecurities[0].SecurityAttributes);
		Assert.Single(dto.DeclSecurities[0].SecurityAttributes[0].NamedArguments);
		Assert.Single(dto.GenericParameters);
		Assert.Single(dto.Interfaces);

		var created = context.TypeDefs.Create(dto);
		EditTestModule.AssertSameDto(dto, context.TypeDefs.ToDto(created));

		Assert.NotNull(created.ClassLayout);
		Assert.Equal(8, created.ClassLayout.PackingSize);
		Assert.Equal(64u, created.ClassLayout.ClassSize);
		Assert.Equal("Base", created.BaseType?.Name.String);
		Assert.Single(created.CustomAttributes);
		Assert.Single(created.DeclSecurities);
		Assert.Single(created.DeclSecurities[0].SecurityAttributes);
		Assert.Single(created.DeclSecurities[0].SecurityAttributes[0].NamedArguments);
		Assert.Single(created.GenericParameters);
		Assert.Single(created.Interfaces);
		Assert.Single(created.Interfaces[0].CustomAttributes);
	}

	[Fact]
	public void TypeWithoutALayoutKeepsHavingNone() {
		var (module, _) = EditTestModule.Create();
		var type = EditTestModule.AddType(module, "Ns", "Widget");
		var context = EditTestModule.Context(module, type);

		var dto = context.TypeDefs.ToDto(type);
		Assert.Null(dto.PackingSize);
		var created = context.TypeDefs.Create(dto);
		Assert.Null(created.ClassLayout);
	}

	[Fact]
	public void MethodOptionsSurviveARoundTrip() {
		var (module, type) = EditTestModule.Create();
		var signature = new MethodSig(
			CallingConvention.VarArg | CallingConvention.HasThis,
			1,
			module.CorLibTypes.Void,
			[module.CorLibTypes.Int32],
			[module.CorLibTypes.String]);
		var method = EditTestModule.AddMethod(type, "Run", signature);
		var declaration = EditTestModule.AddMethod(type, "RunBase");
		method.Overrides.Add(new MethodOverride(method, declaration));
		method.GenericParameters.Add(module.UpdateRowId(new GenericParamUser(0, GenericParamAttributes.NonVariant, "T")));
		var parameter = module.UpdateRowId(new ParamDefUser("count", 1, ParamAttributes.Optional | ParamAttributes.HasDefault) {
			Constant = module.UpdateRowId(new ConstantUser(3, ElementType.I4)),
			MarshalType = new FixedArrayMarshalType(4, NativeType.I4),
		});
		parameter.CustomAttributes.Add(new CustomAttribute(EditTestModule.AddAttributeConstructor(module)));
		method.ParamDefs.Add(parameter);
		method.CustomAttributes.Add(new CustomAttribute(EditTestModule.AddAttributeConstructor(module)));
		method.DeclSecurities.Add(module.UpdateRowId(new DeclSecurityUser(SecurityAction.LinkDemand, [Security(module)])));
		var moduleRef = module.UpdateRowId(new ModuleRefUser(module, "kernel32.dll"));
		method.ImplMap = module.UpdateRowId(new ImplMapUser(moduleRef, "CreateFileW", PInvokeAttributes.CharSetUnicode));

		var context = EditTestModule.Context(module, type);
		var dto = context.MethodDefs.ToDto(method);
		Assert.NotNull(dto.MethodSig);
		Assert.Single(dto.MethodSig.VarArgParameters!);
		Assert.NotNull(dto.ImplMap);
		Assert.Single(dto.Overrides);
		Assert.Single(dto.GenericParameters);
		Assert.Single(dto.ParamDefs);
		Assert.Single(dto.CustomAttributes);
		Assert.Single(dto.DeclSecurities);

		var created = context.MethodDefs.Create(dto);
		EditTestModule.AssertSameDto(dto, context.MethodDefs.ToDto(created));

		Assert.NotNull(created.MethodSig);
		Assert.Equal(1u, created.MethodSig.GenParamCount);
		Assert.Single(created.MethodSig.Params);
		Assert.Single(created.MethodSig.ParamsAfterSentinel);
		Assert.NotNull(created.ImplMap);
		Assert.Equal("kernel32.dll", created.ImplMap.Module.Name.String);
		Assert.Single(created.Overrides);
		Assert.Single(created.ParamDefs);
		Assert.NotNull(created.ParamDefs[0].Constant);
		Assert.NotNull(created.ParamDefs[0].MarshalType);
		Assert.Single(created.ParamDefs[0].CustomAttributes);
		Assert.Single(created.GenericParameters);
		Assert.Single(created.CustomAttributes);
		Assert.Single(created.DeclSecurities);
	}

	[Fact]
	public void FieldOptionsSurviveARoundTrip() {
		var (module, type) = EditTestModule.Create();
		var field = module.UpdateRowId(new FieldDefUser("Data") {
			Attributes = FieldAttributes.Public | FieldAttributes.Static | FieldAttributes.HasFieldRVA,
			FieldSig = new FieldSig(module.CorLibTypes.Int32),
			FieldOffset = 16,
			RVA = (dnlib.PE.RVA)0x1234,
			InitialValue = [1, 2, 3],
			Constant = module.UpdateRowId(new ConstantUser(7, ElementType.I4)),
			MarshalType = new ArrayMarshalType(NativeType.I4, 2, 4, 0),
		});
		field.CustomAttributes.Add(new CustomAttribute(EditTestModule.AddAttributeConstructor(module)));
		type.Fields.Add(field);

		var context = EditTestModule.Context(module, type);
		var dto = context.FieldDefs.ToDto(field);
		Assert.NotNull(dto.FieldSig);
		Assert.NotNull(dto.Constant);
		Assert.NotNull(dto.MarshalType);
		Assert.NotNull(dto.InitialValue);
		Assert.Single(dto.CustomAttributes);

		var created = context.FieldDefs.Create(dto);
		EditTestModule.AssertSameDto(dto, context.FieldDefs.ToDto(created));

		Assert.Equal(16u, created.FieldOffset);
		Assert.Equal(0x1234u, (uint)created.RVA);
		Assert.Equal(new byte[] { 1, 2, 3 }, created.InitialValue);
		Assert.NotNull(created.Constant);
		Assert.NotNull(created.MarshalType);
		Assert.Single(created.CustomAttributes);
	}

	/// <summary>A field without the RVA attribute keeps none of its bytes, which is the rule dnSpy's own
	/// view model applies before it builds its options.</summary>
	[Fact]
	public void FieldInitialValueIsDroppedWhenTheAttributeIsMissing() {
		var (module, type) = EditTestModule.Create();
		var field = module.UpdateRowId(new FieldDefUser("Data") {
			Attributes = FieldAttributes.Public,
			FieldSig = new FieldSig(module.CorLibTypes.Int32),
			InitialValue = [1, 2, 3],
		});
		type.Fields.Add(field);

		var context = EditTestModule.Context(module, type);
		var created = context.FieldDefs.Create(context.FieldDefs.ToDto(field));
		Assert.Null(created.InitialValue);
	}

	[Fact]
	public void PropertyOptionsSurviveARoundTrip() {
		var (module, type) = EditTestModule.Create();
		var getter = EditTestModule.AddMethod(type, "get_Value", MethodSig.CreateInstance(module.CorLibTypes.Int32));
		var setter = EditTestModule.AddMethod(type, "set_Value", MethodSig.CreateInstance(module.CorLibTypes.Void, module.CorLibTypes.Int32));
		var property = module.UpdateRowId(new PropertyDefUser {
			Name = "Value",
			PropertySig = PropertySig.CreateInstance(module.CorLibTypes.Int32),
			Constant = module.UpdateRowId(new ConstantUser(5, ElementType.I4)),
		});
		property.GetMethods.Add(getter);
		getter.IsGetter = true;
		property.SetMethods.Add(setter);
		setter.IsSetter = true;
		property.CustomAttributes.Add(new CustomAttribute(EditTestModule.AddAttributeConstructor(module)));
		type.Properties.Add(property);

		var context = EditTestModule.Context(module, type);
		var dto = context.PropertyDefs.ToDto(property);
		Assert.Single(dto.GetMethods);
		Assert.Single(dto.SetMethods);
		Assert.NotNull(dto.PropertySig);
		Assert.NotNull(dto.Constant);
		Assert.Single(dto.CustomAttributes);

		var created = context.PropertyDefs.Create(type, dto);
		EditTestModule.AssertSameDto(dto, context.PropertyDefs.ToDto(created));

		Assert.Single(created.GetMethods);
		Assert.Single(created.SetMethods);
		Assert.Same(getter, created.GetMethods[0]);
		Assert.Same(setter, created.SetMethods[0]);
		Assert.NotNull(created.Constant);
		Assert.Single(created.CustomAttributes);
	}

	[Fact]
	public void EventOptionsSurviveARoundTrip() {
		var (module, type) = EditTestModule.Create();
		var add = EditTestModule.AddMethod(type, "add_Changed", MethodSig.CreateInstance(module.CorLibTypes.Void, module.CorLibTypes.Object));
		var remove = EditTestModule.AddMethod(type, "remove_Changed", MethodSig.CreateInstance(module.CorLibTypes.Void, module.CorLibTypes.Object));
		var handler = EditTestModule.AddType(module, "System", "EventHandler");
		var @event = module.UpdateRowId(new EventDefUser {
			Name = "Changed",
			EventType = handler,
		});
		@event.AddMethod = add;
		add.IsAddOn = true;
		@event.RemoveMethod = remove;
		remove.IsRemoveOn = true;
		@event.CustomAttributes.Add(new CustomAttribute(EditTestModule.AddAttributeConstructor(module)));
		type.Events.Add(@event);

		var context = EditTestModule.Context(module, type);
		var dto = context.EventDefs.ToDto(@event);
		Assert.NotNull(dto.EventType);
		Assert.NotNull(dto.AddMethod);
		Assert.NotNull(dto.RemoveMethod);
		Assert.Single(dto.CustomAttributes);

		var created = context.EventDefs.Create(type, dto);
		EditTestModule.AssertSameDto(dto, context.EventDefs.ToDto(created));

		Assert.Same(add, created.AddMethod);
		Assert.Same(remove, created.RemoveMethod);
		Assert.Single(created.CustomAttributes);
	}

	/// <summary>
	/// A method that stops being an accessor has to lose its mark: dnlib writes the <c>MethodSemantics</c>
	/// rows straight out of these flags, so a stale one produces a table row that says the method is the
	/// getter of a property it has nothing to do with.
	/// </summary>
	[Fact]
	public void ReplacingAPropertyGetterClearsTheOldMark() {
		var (module, type) = EditTestModule.Create();
		var getter = EditTestModule.AddMethod(type, "get_Value", MethodSig.CreateInstance(module.CorLibTypes.Int32));
		var replacement = EditTestModule.AddMethod(type, "Fetch", MethodSig.CreateInstance(module.CorLibTypes.Int32));
		var property = module.UpdateRowId(new PropertyDefUser { Name = "Value", PropertySig = PropertySig.CreateInstance(module.CorLibTypes.Int32) });
		property.GetMethods.Add(getter);
		getter.IsGetter = true;
		type.Properties.Add(property);

		var context = EditTestModule.Context(module, type);
		var dto = context.PropertyDefs.ToDto(property);
		context.PropertyDefs.CopyTo(property, type, dto with { GetMethods = [context.Accessors.ToDto(replacement)!] });

		Assert.False(getter.IsGetter);
		Assert.True(replacement.IsGetter);
		Assert.Same(replacement, Assert.Single(property.GetMethods));
	}

	[Fact]
	public void ReplacingAnEventAccessorClearsTheOldMark() {
		var (module, type) = EditTestModule.Create();
		var add = EditTestModule.AddMethod(type, "add_Changed", MethodSig.CreateInstance(module.CorLibTypes.Void, module.CorLibTypes.Object));
		var replacement = EditTestModule.AddMethod(type, "Attach", MethodSig.CreateInstance(module.CorLibTypes.Void, module.CorLibTypes.Object));
		var @event = module.UpdateRowId(new EventDefUser { Name = "Changed", EventType = module.CorLibTypes.Object.ToTypeDefOrRef() });
		@event.AddMethod = add;
		add.IsAddOn = true;
		type.Events.Add(@event);

		var context = EditTestModule.Context(module, type);
		context.EventDefs.CopyTo(
			@event,
			type,
			context.EventDefs.ToDto(@event) with { AddMethod = context.Accessors.ToDto(replacement) });

		Assert.False(add.IsAddOn);
		Assert.True(replacement.IsAddOn);
		Assert.Same(replacement, @event.AddMethod);
	}

	/// <summary>An accessor named by node id, which is how a client that picked it from the tree names it.</summary>
	[Fact]
	public void AccessorsCanBeNamedByNodeId() {
		var (module, type) = EditTestModule.Create();
		var getter = EditTestModule.AddMethod(type, "get_Value", MethodSig.CreateInstance(module.CorLibTypes.Int32));
		var property = module.UpdateRowId(new PropertyDefUser { Name = "Value", PropertySig = PropertySig.CreateInstance(module.CorLibTypes.Int32) });
		type.Properties.Add(property);

		var context = EditTestModule.Context(module, type);
		var nodeId = $"/tmp/TestModule.dll:method:{getter.MDToken.Raw:X8}";
		context.PropertyDefs.CopyTo(
			property,
			type,
			new PropertyOptionsDto(0, "Value", null, null, [new AccessorRefDto("get_Value", 0, nodeId)], [], [], []));

		Assert.True(getter.IsGetter);
		Assert.Same(getter, Assert.Single(property.GetMethods));
	}

	/// <summary>
	/// A name that two methods of the type share cannot be resolved, since either one could be meant;
	/// naming the row by its node id is what disambiguates it.
	/// </summary>
	[Fact]
	public void AnAmbiguousAccessorNameIsRejected() {
		var (module, type) = EditTestModule.Create();
		EditTestModule.AddMethod(type, "Fetch", MethodSig.CreateInstance(module.CorLibTypes.Int32));
		EditTestModule.AddMethod(type, "Fetch", MethodSig.CreateInstance(module.CorLibTypes.String));
		var property = module.UpdateRowId(new PropertyDefUser { Name = "Value", PropertySig = PropertySig.CreateInstance(module.CorLibTypes.Int32) });
		type.Properties.Add(property);

		var context = EditTestModule.Context(module, type);
		var exception = Assert.Throws<RpcException>(() => context.PropertyDefs.CopyTo(
			property,
			type,
			new PropertyOptionsDto(0, "Value", null, null, [new AccessorRefDto("Fetch")], [], [], [])));
		Assert.Contains("Fetch", exception.Message, StringComparison.Ordinal);
	}

	/// <summary>
	/// Every row a create makes is given its row id up front. Without it the token is zero, every new row
	/// of a kind would derive the same explorer node id, and the model the node id stands for would be
	/// whichever of them the workspace happened to hold last.
	/// </summary>
	[Fact]
	public void CreatedRowsAreGivenTheirRowId() {
		var (module, type) = EditTestModule.Create();
		var context = EditTestModule.Context(module, type);

		var first = context.MethodDefs.Create(context.MethodDefs.ToDto(EditTestModule.AddMethod(type, "One")));
		var second = context.MethodDefs.Create(context.MethodDefs.ToDto(EditTestModule.AddMethod(type, "Two")));

		Assert.Equal(Table.Method, first.MDToken.Table);
		Assert.NotEqual(0u, first.MDToken.Rid);
		Assert.NotEqual(0u, second.MDToken.Rid);
		Assert.NotEqual(first.MDToken.Raw, second.MDToken.Raw);
	}

	/// <summary>
	/// A security attribute with one named argument. dnSpy's view model can add and remove these, so a
	/// conversion that dropped them would silently widen a declaration's permissions on the next save.
	/// </summary>
	static SecurityAttribute Security(ModuleDef module) {
		var attribute = new SecurityAttribute(EditTestModule.AddType(module, "System", "SecurityAttribute"));
		attribute.NamedArguments.Add(new CANamedArgument(
			false,
			module.CorLibTypes.String,
			"Action",
			new CAArgument(module.CorLibTypes.String, "Demand")));
		return attribute;
	}
}
