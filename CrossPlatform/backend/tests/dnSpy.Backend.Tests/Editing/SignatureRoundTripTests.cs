using dnlib.DotNet;
using dnSpy.Backend.Contracts;
using dnSpy.Backend.Core.Editing;
using Xunit;

namespace dnSpy.Backend.Tests.Editing;

/// <summary>
/// Checks the signature trees the dialogs assemble. These need cases of their own because two shapes that
/// read as the same name — <c>int[]</c> the vector and <c>int[]</c> the rank-one array — are different rows
/// in metadata, and because a shape the conversion flattens would take the rest of the tree with it.
/// </summary>
public sealed class SignatureRoundTripTests {
	[Fact]
	public void PrimitivesKeepTheirElementType() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var dto = context.Signatures.ToDtoRequired(module.CorLibTypes.Int32);
		Assert.Equal(TypeSigKinds.Type, dto.Kind);
		Assert.Equal("System", dto.Type?.Namespace);
		Assert.Equal("Int32", dto.Type?.Name);
		Assert.True(dto.ValueType);

		var rebuilt = context.Signatures.FromDtoRequired(dto);
		Assert.Equal(ElementType.I4, rebuilt.ElementType);
		Assert.Same(module.CorLibTypes.Int32, rebuilt);
	}

	/// <summary>A vector and a rank-one array are the same text but different metadata, and dnSpy's
	/// creator has a button for each, so the distinction has to survive.</summary>
	[Fact]
	public void AVectorAndAZeroRankArrayStayApart() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var vectorDto = context.Signatures.ToDtoRequired(new SZArraySig(module.CorLibTypes.Int32));
		var arrayDto = context.Signatures.ToDtoRequired(new ArraySig(module.CorLibTypes.Int32));
		Assert.Equal(TypeSigKinds.SzArray, vectorDto.Kind);
		Assert.Equal(TypeSigKinds.Array, arrayDto.Kind);
		Assert.Equal(0, arrayDto.Rank);

		Assert.IsType<SZArraySig>(context.Signatures.FromDtoRequired(vectorDto));
		var rebuiltArray = Assert.IsType<ArraySig>(context.Signatures.FromDtoRequired(arrayDto));
		Assert.Equal(0u, rebuiltArray.Rank);
	}

	[Fact]
	public void ArrayRankSizesAndLowerBoundsSurvive() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var dto = context.Signatures.ToDtoRequired(new ArraySig(module.CorLibTypes.Int32, 2, [3u, 4u], [1, 0]));
		Assert.Equal(2, dto.Rank);
		Assert.Equal(new[] { 3, 4 }, dto.Sizes);
		Assert.Equal(new[] { 1, 0 }, dto.LowerBounds);

		var rebuilt = Assert.IsType<ArraySig>(context.Signatures.FromDtoRequired(dto));
		Assert.Equal(2u, rebuilt.Rank);
		Assert.Equal(new uint[] { 3, 4 }, rebuilt.Sizes);
		Assert.Equal(new[] { 1, 0 }, rebuilt.LowerBounds);
	}

	/// <summary>A generic parameter of the type and one of the method are told apart by their kind alone;
	/// which type or method owns them is resolved when the signature is put to use.</summary>
	[Fact]
	public void GenericParametersKeepTheirKind() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var variable = context.Signatures.ToDtoRequired(new GenericVar(1));
		var methodVariable = context.Signatures.ToDtoRequired(new GenericMVar(2));
		Assert.Equal(TypeSigKinds.GenericVar, variable.Kind);
		Assert.Equal(TypeSigKinds.GenericMVar, methodVariable.Kind);

		Assert.Equal(1u, Assert.IsType<GenericVar>(context.Signatures.FromDtoRequired(variable)).Number);
		Assert.Equal(2u, Assert.IsType<GenericMVar>(context.Signatures.FromDtoRequired(methodVariable)).Number);
	}

	[Fact]
	public void ModifiersKeepTheirOrderAndTheirTarget() {
		var (module, _) = EditTestModule.Create();
		var optional = EditTestModule.AddType(module, "Ns", "OptionalAttribute");
		var required = EditTestModule.AddType(module, "Ns", "RequiredAttribute");
		var context = EditTestModule.Context(module);

		// int32 modified by a required modifier, and that whole thing by an optional one.
		var signature = new CModOptSig(optional, new CModReqdSig(required, module.CorLibTypes.Int32));
		var dto = context.Signatures.ToDtoRequired(signature);
		Assert.Equal(TypeSigKinds.CModOpt, dto.Kind);
		Assert.Equal(TypeSigKinds.CModReqd, dto.Element?.Kind);
		Assert.Equal(TypeSigKinds.Type, dto.Element?.Element?.Kind);
		Assert.Equal("OptionalAttribute", dto.Modifier?.Type?.Name);
		Assert.Equal("RequiredAttribute", dto.Element?.Modifier?.Type?.Name);

		var rebuilt = Assert.IsType<CModOptSig>(context.Signatures.FromDtoRequired(dto));
		Assert.Equal(optional.Name.String, rebuilt.Modifier.Name.String);
		var inner = Assert.IsType<CModReqdSig>(rebuilt.Next);
		Assert.Equal(required.Name.String, inner.Modifier.Name.String);
		Assert.Equal(ElementType.I4, inner.Next.ElementType);
	}

	[Fact]
	public void PointersReferencesAndPinnedTypesSurvive() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var pointer = context.Signatures.ToDtoRequired(new PtrSig(module.CorLibTypes.Int32));
		var byRef = context.Signatures.ToDtoRequired(new ByRefSig(module.CorLibTypes.Int32));
		var pinned = context.Signatures.ToDtoRequired(new PinnedSig(module.CorLibTypes.Int32));

		Assert.Equal(TypeSigKinds.Pointer, pointer.Kind);
		Assert.Equal(TypeSigKinds.ByRef, byRef.Kind);
		Assert.Equal(TypeSigKinds.Pinned, pinned.Kind);

		Assert.Equal(ElementType.I4, Assert.IsType<PtrSig>(context.Signatures.FromDtoRequired(pointer)).Next.ElementType);
		Assert.Equal(ElementType.I4, Assert.IsType<ByRefSig>(context.Signatures.FromDtoRequired(byRef)).Next.ElementType);
		Assert.Equal(ElementType.I4, Assert.IsType<PinnedSig>(context.Signatures.FromDtoRequired(pinned)).Next.ElementType);
	}

	[Fact]
	public void GenericInstancesKeepTheirArguments() {
		var (module, _) = EditTestModule.Create();
		var list = EditTestModule.AddType(module, "Ns", "List`1");
		var context = EditTestModule.Context(module);

		var dto = context.Signatures.ToDtoRequired(new GenericInstSig(
			new ClassSig(list),
			module.CorLibTypes.Int32,
			module.CorLibTypes.String));
		Assert.Equal(TypeSigKinds.GenericInst, dto.Kind);
		Assert.Equal("List`1", dto.Type?.Name);
		Assert.Equal(2, dto.Arguments?.Count);

		var rebuilt = Assert.IsType<GenericInstSig>(context.Signatures.FromDtoRequired(dto));
		Assert.Equal("List`1", rebuilt.GenericType.TypeDefOrRef.Name.String);
		Assert.Equal(new[] { ElementType.I4, ElementType.String }, rebuilt.GenericArguments.Select(argument => argument.ElementType));
	}

	[Fact]
	public void NestedTypesAreNamedTheWayMetadataNamesThem() {
		var (module, _) = EditTestModule.Create();
		var outer = EditTestModule.AddType(module, "Ns", "Outer");
		var inner = module.UpdateRowId(new TypeDefUser("Inner"));
		outer.NestedTypes.Add(inner);
		var context = EditTestModule.Context(module);

		var reference = context.Signatures.TypeOf(inner);
		Assert.Equal("Ns", reference.Namespace);
		Assert.Equal("Outer/Inner", reference.Name);

		var rebuilt = context.Signatures.FromDtoRequired(context.Signatures.ToDtoRequired(inner.ToTypeSig()));
		Assert.Same(inner, rebuilt.ToTypeDefOrRef().ResolveTypeDef());
	}

	[Fact]
	public void FunctionPointerSignaturesKeepTheirSignature() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var dto = context.Signatures.ToDtoRequired(new FnPtrSig(MethodSig.CreateInstance(module.CorLibTypes.Void, module.CorLibTypes.Int32)));
		Assert.Equal(TypeSigKinds.FnPtr, dto.Kind);
		Assert.NotNull(dto.FunctionPointer);
		Assert.Equal("Void", dto.FunctionPointer.ReturnType.Type?.Name);
		Assert.Equal("Int32", Assert.Single(dto.FunctionPointer.Parameters).Type?.Name);

		var rebuilt = Assert.IsType<FnPtrSig>(context.Signatures.FromDtoRequired(dto));
		var signature = Assert.IsType<MethodSig>(rebuilt.Signature);
		Assert.Equal(ElementType.Void, signature.RetType.ElementType);
		Assert.Equal(ElementType.I4, Assert.Single(signature.Params).ElementType);
	}

	[Fact]
	public void MethodSignaturesSurvive() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var signature = new MethodSig(
			CallingConvention.VarArg | CallingConvention.HasThis | CallingConvention.ExplicitThis,
			2,
			module.CorLibTypes.Void,
			[module.CorLibTypes.Int32, new ByRefSig(module.CorLibTypes.String)],
			[module.CorLibTypes.Object]);
		var dto = context.Signatures.MethodToDto(signature);
		Assert.Equal(2, dto.GenericParameterCount);
		Assert.Equal(2, dto.Parameters.Count);
		Assert.Single(dto.VarArgParameters!);

		var rebuilt = context.Signatures.MethodFromDto(dto);
		Assert.Equal(2u, rebuilt.GenParamCount);
		Assert.Equal(2, rebuilt.Params.Count);
		Assert.True(rebuilt.HasThis);
		Assert.True(rebuilt.ExplicitThis);
		Assert.Equal(CallingConvention.VarArg | CallingConvention.HasThis | CallingConvention.ExplicitThis, rebuilt.CallingConvention);
		Assert.Single(rebuilt.ParamsAfterSentinel);
	}

	[Fact]
	public void PropertySignaturesSurvive() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var dto = context.Signatures.PropertyToDto(PropertySig.CreateInstance(module.CorLibTypes.String, module.CorLibTypes.Int32));
		Assert.True(dto.HasThis);
		Assert.Single(dto.Parameters);

		var rebuilt = context.Signatures.PropertyFromDto(dto);
		Assert.True(rebuilt.HasThis);
		Assert.Equal(ElementType.String, rebuilt.RetType.ElementType);
		Assert.Equal(ElementType.I4, Assert.Single(rebuilt.Params).ElementType);
	}

	/// <summary>
	/// An enum's default value is stored under the enum's underlying type — the row has no way to name the
	/// enum itself — so a conversion that reported the field's own type would write a row that cannot hold
	/// the value it was given.
	/// </summary>
	[Fact]
	public void AnEnumDefaultValueKeepsItsUnderlyingType() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var dto = context.Constants.ToDto(module.UpdateRowId(new ConstantUser(1, ElementType.I4)));
		Assert.NotNull(dto);
		Assert.Equal((int)ElementType.I4, dto.ElementType);
		Assert.Equal("1", dto.Value);

		var rebuilt = context.Constants.FromDto(dto);
		Assert.NotNull(rebuilt);
		Assert.Equal(ElementType.I4, rebuilt.Type);
		Assert.Equal(1, rebuilt.Value);
	}

	[Fact]
	public void ConstantsOfEveryWidthSurvive() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		foreach (var (value, element) in new (object, ElementType)[] {
			(true, ElementType.Boolean),
			('x', ElementType.Char),
			(sbyte.MinValue, ElementType.I1),
			(byte.MaxValue, ElementType.U1),
			(short.MinValue, ElementType.I2),
			(ushort.MaxValue, ElementType.U2),
			(int.MinValue, ElementType.I4),
			(uint.MaxValue, ElementType.U4),
			(long.MinValue, ElementType.I8),
			(ulong.MaxValue, ElementType.U8),
			(float.MaxValue, ElementType.R4),
			(double.MaxValue, ElementType.R8),
			("text", ElementType.String),
		}) {
			var rebuilt = context.Constants.FromDto(context.Constants.ToDto(module.UpdateRowId(new ConstantUser(value, element))));
			Assert.NotNull(rebuilt);
			Assert.Equal(element, rebuilt.Type);
			Assert.Equal(DnlibDisplay.LiteralText(value), DnlibDisplay.LiteralText(rebuilt.Value));
		}
	}

	/// <summary>
	/// The marshalling row's payload fields are only meaningful for some native types — only an array has
	/// a parameter number, only a fixed array has an element type — and dnlib answers for each one with a
	/// validity flag. A conversion that wrote every field regardless would invent data the row never held.
	/// </summary>
	[Fact]
	public void MarshalTypesKeepTheirPayloadAndTheirGaps() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var array = context.MarshalTypes.ToDto(new ArrayMarshalType(NativeType.I4, 2, 4, 3));
		Assert.NotNull(array);
		Assert.Equal((int)NativeType.Array, array.NativeType);
		Assert.Equal((int)NativeType.I4, array.ElementType);
		Assert.Equal(2, array.ParamNumber);
		Assert.Equal(4, array.Size);
		Assert.Equal(3, array.Flags);

		var rebuiltArray = Assert.IsType<ArrayMarshalType>(context.MarshalTypes.FromDto(array));
		Assert.Equal(NativeType.I4, rebuiltArray.ElementType);
		Assert.Equal((ushort)2, rebuiltArray.ParamNumber);
		Assert.Equal(4, rebuiltArray.Size);
		Assert.Equal(3, rebuiltArray.Flags);

		// A fixed array has no parameter number at all, so it must read back without one.
		var fixedArray = context.MarshalTypes.ToDto(new FixedArrayMarshalType(4, NativeType.I4));
		Assert.NotNull(fixedArray);
		Assert.Null(fixedArray.ParamNumber);
		var rebuiltFixedArray = Assert.IsType<FixedArrayMarshalType>(context.MarshalTypes.FromDto(fixedArray));
		Assert.Equal(NativeType.I4, rebuiltFixedArray.ElementType);
		Assert.Equal(4, rebuiltFixedArray.Size);
	}

	/// <summary>A state the picker itself can produce but that no name resolves to still has to survive,
	/// since the dialog shows it as the element type of a fixed array the user has not filled in yet.</summary>
	[Fact]
	public void AMarshallingTypeWithNoElementTypeKeepsNone() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var dto = context.MarshalTypes.ToDto(new FixedArrayMarshalType(0, NativeType.NotInitialized));
		Assert.NotNull(dto);
		Assert.Null(dto.ElementType);

		var rebuilt = Assert.IsType<FixedArrayMarshalType>(context.MarshalTypes.FromDto(dto));
		Assert.False(rebuilt.IsElementTypeValid);
	}

	[Fact]
	public void CustomMarshalersSurvive() {
		var (module, _) = EditTestModule.Create();
		var custom = EditTestModule.AddType(module, "Ns", "MyMarshaler");
		var context = EditTestModule.Context(module);

		var dto = context.MarshalTypes.ToDto(new CustomMarshalType("guid", "MyMarshaler", custom, "cookie"));
		Assert.NotNull(dto);
		Assert.Equal("guid", dto.Guid);
		Assert.Equal("MyMarshaler", dto.NativeTypeName);
		Assert.Equal("cookie", dto.Cookie);
		Assert.NotNull(dto.UserDefinedSubType);

		var rebuilt = Assert.IsType<CustomMarshalType>(context.MarshalTypes.FromDto(dto));
		Assert.Equal("guid", rebuilt.Guid?.String);
		Assert.Equal("MyMarshaler", rebuilt.NativeTypeName?.String);
		Assert.Equal("cookie", rebuilt.Cookie?.String);
		Assert.Same(custom, rebuilt.CustomMarshaler?.ResolveTypeDef());
	}

	[Fact]
	public void SafeArraysKeepTheirElementType() {
		var (module, _) = EditTestModule.Create();
		var element = EditTestModule.AddType(module, "Ns", "Element");
		var context = EditTestModule.Context(module);

		var dto = context.MarshalTypes.ToDto(new SafeArrayMarshalType(VariantType.Variant, element));
		Assert.NotNull(dto);
		Assert.Equal((int)VariantType.Variant, dto.VariantType);
		Assert.NotNull(dto.UserDefinedSubType);

		var rebuilt = Assert.IsType<SafeArrayMarshalType>(context.MarshalTypes.FromDto(dto));
		Assert.Equal(VariantType.Variant, rebuilt.VariantType);
		Assert.Same(element, rebuilt.UserDefinedSubType?.ResolveTypeDef());
	}

	[Fact]
	public void RawMarshallingBlobsSurvive() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var dto = context.MarshalTypes.ToDto(new RawMarshalType([0x01, 0x02]));
		Assert.NotNull(dto);
		var rebuilt = Assert.IsType<RawMarshalType>(context.MarshalTypes.FromDto(dto));
		Assert.Equal(new byte[] { 0x01, 0x02 }, rebuilt.Data);
	}

	/// <summary>
	/// A signature the dialogs cannot express — <c>Sentinel</c> is only meaningful inside a method
	/// signature's parameter list, and dnSpy's creator has no button for it — has to be reported rather
	/// than written back as something else, which would change the type behind the user's back.
	/// </summary>
	[Fact]
	public void ASignatureTheDialogsCannotExpressIsReported() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var exception = Assert.Throws<RpcException>(() => context.Signatures.ToDtoRequired(new SentinelSig()));
		Assert.Contains("Sentinel", exception.Message, StringComparison.Ordinal);
	}

	[Fact]
	public void AnUnknownSignatureKindIsReported() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var exception = Assert.Throws<RpcException>(() => context.Signatures.FromDtoRequired(new TypeSigDto("nonsense")));
		Assert.Contains("nonsense", exception.Message, StringComparison.Ordinal);
	}

	/// <summary>
	/// A slot the dialog has opened but the user has not filled in — a generic argument, whose count the
	/// type decided. dnSpy's creator refuses to hand back an array of type signatures short of its count
	/// either, so a signature that still holds one is refused here rather than written with a hole in it.
	/// </summary>
	[Fact]
	public void AnUnfilledSlotIsRefused() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var exception = Assert.Throws<RpcException>(() => context.Signatures.FromDtoRequired(new TypeSigDto(TypeSigKinds.Empty)));
		Assert.Equal(ErrorCodes.EditValidationFailed, exception.Code);
	}

	/// <summary>
	/// A dialog picks a type by name and cannot tell a struct from a class, so the definition settles it.
	/// Without this a field typed by a struct picked out of the tree would be written as a class.
	/// </summary>
	[Fact]
	public void AResolvedDefinitionDecidesWhetherTheTypeIsAValueType() {
		var module = ModuleDefMD.Load(typeof(EditTestModule).Assembly.Location);
		var context = EditTestModule.Context(module);

		Assert.IsType<ValueTypeSig>(context.Signatures.FromDtoRequired(Named("SampleValue")));
		Assert.IsType<ClassSig>(context.Signatures.FromDtoRequired(Named("SampleClass")));
	}

	/// <summary>
	/// A DTO that says what it is keeps the last word: a type in an assembly nothing on this machine can
	/// resolve has no definition to ask, so the name alone decides nothing.
	/// </summary>
	[Fact]
	public void AValueTypeThatResolvesToNothingIsStillAValueType() {
		var (module, _) = EditTestModule.Create();
		var context = EditTestModule.Context(module);

		var dto = Named("Missing") with { ValueType = true, Type = new TypeRefDto("No.Such.Assembly", "Ns", "Missing") };
		Assert.IsType<ValueTypeSig>(context.Signatures.FromDtoRequired(dto));
	}

	static TypeSigDto Named(string name) => new(TypeSigKinds.Type, new TypeRefDto("", "dnSpy.Backend.Tests.Editing", name));
}

/// <summary>
/// A value type and a reference type of the test assembly itself, for the cases that need a type's own
/// definition — not a signature's element type — to decide what its signature has to be.
/// </summary>
public struct SampleValue { }

public sealed class SampleClass { }
