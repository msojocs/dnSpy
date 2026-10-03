using dnlib.DotNet;
using dnlib.DotNet.Emit;
using dnlib.IO;
using dnlib.PE;

namespace dnSpy.Backend.Core;

/// <summary>
/// Where dnSpy's hex commands point, in file offsets: a member's RVA turned into an offset, a method
/// body's bounds, and the bytes its "write body" commands install.
/// </summary>
/// <remarks>
/// Ported from dnSpy.Contracts.Logic's <c>Extensions.GetRVA</c>/<c>ToFileOffset</c> and
/// dnSpy.AsmEditor's <c>InstructionUtils</c> plus <c>TVWriteEmptyBodyHexEditorCommand</c> (GPL-3.0).
/// Everything here is best-effort: a member with no RVA or a non-<see cref="ModuleDefMD"/> module
/// yields "no target", which the caller turns into a hidden menu entry, exactly as dnSpy does.
/// </remarks>
static class HexTargets {
	/// <summary>The file offset of a method or field's data, or null when it has none.</summary>
	public static long? GetMemberFileOffset(IMemberDef? member) {
		var rva = member switch {
			MethodDef method => (uint)method.RVA,
			FieldDef field => (uint)field.RVA,
			_ => 0u,
		};
		if (rva == 0)
			return null;
		return ToFileOffset(member!.Module, rva);
	}

	static long? ToFileOffset(ModuleDef? module, uint rva) =>
		// The TODO in dnSpy: this only works for a module read from a PE image, which is all this port loads.
		module is ModuleDefMD md ? (uint)md.Metadata.PEImage.ToFileOffset((RVA)rva) : null;

	/// <summary>
	/// A method body's file bounds: where the body starts, its total length, where the IL code starts
	/// after the header, and the code's length. Mirrors dnSpy's <c>InstructionUtils.GetTotalMethodBodyLength</c>,
	/// which walks the tiny/fat header and the exception-handler clauses that follow the code.
	/// </summary>
	public static bool TryGetMethodBody(MethodDef method, out long bodyOffset, out long bodySize, out long codeOffset, out long codeSize) {
		bodyOffset = bodySize = codeOffset = codeSize = 0;
		if (method.RVA == 0 || method.Module is not ModuleDefMD module)
			return false;
		try {
			var reader = module.Metadata.PEImage.CreateReader();
			reader.Position = (uint)module.Metadata.PEImage.ToFileOffset((RVA)method.RVA);
			var start = reader.Position;
			if (!ReadHeader(ref reader, out var flags, out var codeLength))
				return false;
			var headerSize = reader.Position - start;

			reader.Position += codeLength;
			if ((flags & 8) != 0) {
				reader.Position = (reader.Position + 3) & ~3U;
				var b = reader.ReadByte();
				if ((b & 0x3F) != 1)
					reader.Position--;
				else if ((b & 0x40) != 0) {
					reader.Position--;
					var count = (ushort)((reader.ReadUInt32() >> 8) / 24);
					reader.Position += (uint)count * 24;
				}
				else {
					var count = (uint)(reader.ReadByte() / 12);
					reader.Position += 2 + count * 12;
				}
			}

			bodyOffset = start;
			bodySize = reader.Position - start;
			codeOffset = start + headerSize;
			codeSize = codeLength;
			return bodySize > 0;
		}
		catch {
			return false;
		}
	}

	static bool ReadHeader(ref DataReader reader, out ushort flags, out uint codeSize) {
		var b = reader.ReadByte();
		switch (b & 7) {
		case 2:
		case 6:
			flags = 2;
			codeSize = (uint)(b >> 2);
			return true;

		case 3:
			flags = (ushort)((reader.ReadByte() << 8) | b);
			var headerSize = (byte)(flags >> 12);
			reader.ReadUInt16();					// max stack
			codeSize = reader.ReadUInt32();
			reader.ReadUInt32();					// local var sig token

			reader.Position = (uint)(reader.Position - 12 + headerSize * 4);
			if (headerSize < 3)
				flags &= 0xFFF7;
			return true;

		default:
			flags = 0;
			codeSize = 0;
			return false;
		}
	}

	/// <summary>
	/// The stretch of file a patch written over <paramref name="value"/> is allowed to cover: where it
	/// starts and how long it is. Null where nothing bounds it, in which case only the file's length does —
	/// that is dnSpy's rule too, a body may only be overwritten by bytes that fit in it.
	/// </summary>
	public static (long Offset, long Size)? GetPatchRegion(object? value) => value switch {
		MethodDef method when TryGetMethodBody(method, out var bodyOffset, out var bodySize, out _, out _) =>
			(bodyOffset, bodySize),
		FieldDef field when GetMemberFileOffset(field) is { } fieldOffset =>
			(fieldOffset, field.InitialValue?.Length ?? 0),
		EmbeddedResource resource => ((long)resource.CreateReader().StartOffset, resource.CreateReader().Length),
		_ => null,
	};

	/// <summary>
	/// The bytes dnSpy's "Hex Write 'return true' Body" installs. Only a <c>bool</c>-returning method
	/// qualifies; the bytes are the literal ones from the WPF command (<c>stloc.0, ldc.i4.1, ret</c>).
	/// </summary>
	public static byte[]? GetReturnTrueBody(MethodDef method) => ReturnsBoolean(method) ? [0x0A, 0x17, 0x2A] : null;

	/// <summary>The bytes "Hex Write 'return false' Body" installs.</summary>
	public static byte[]? GetReturnFalseBody(MethodDef method) => ReturnsBoolean(method) ? [0x0A, 0x16, 0x2A] : null;

	static bool ReturnsBoolean(MethodDef method) =>
		method.MethodSig?.GetRetType().RemovePinnedAndModifiers().ElementType == ElementType.Boolean;

	/// <summary>
	/// The bytes "Hex Write Empty Body" installs, chosen from the return type. Null where dnSpy has no
	/// template — a <c>bool</c> (the two commands above own it), or a type that would need a local (a
	/// generic, <c>TypedByRef</c>, or a value type that is not an enum).
	/// </summary>
	public static byte[]? GetEmptyBody(MethodDef method) {
		var returnType = method.MethodSig?.GetRetType().RemovePinnedAndModifiers();
		if (returnType is null || returnType.ElementType == ElementType.Boolean)
			return null;
		return GetEmptyBody(returnType, 0);
	}

	static byte[]? GetEmptyBody(TypeSig typeSig, int level) {
		// A value type that is not an enum needs ldloca/initobj/ldloc and a local variable dnSpy refuses
		// to synthesize, so it declines rather than write a body that will not verify. The depth guard
		// stops a pathological enum chain.
		if (level >= 10)
			return null;
		var returnType = typeSig.RemovePinnedAndModifiers();
		switch (returnType.ElementType) {
		case ElementType.Void:
			return [0x06, 0x2A];							// ldloc.0, ret (dnSpy's literal bytes)
		case ElementType.Boolean:
		case ElementType.Char:
		case ElementType.I1:
		case ElementType.U1:
		case ElementType.I2:
		case ElementType.U2:
		case ElementType.I4:
		case ElementType.U4:
			return [0x0A, 0x16, 0x2A];						// stloc.0, ldc.i4.0, ret
		case ElementType.I8:
		case ElementType.U8:
			return [0x0E, 0x16, 0x6A, 0x2A];				// ldc.i4.0, conv.i8, ret
		case ElementType.R4:
			return [0x0E, 0x16, 0x6B, 0x2A];				// ldc.i4.0, conv.r4, ret
		case ElementType.R8:
			return [0x0E, 0x16, 0x6C, 0x2A];				// ldc.i4.0, conv.r8, ret
		case ElementType.I:
			return [0x0E, 0x16, 0xD3, 0x2A];				// ldc.i4.0, conv.i, ret
		case ElementType.U:
		case ElementType.Ptr:
		case ElementType.FnPtr:
			return [0x0E, 0x16, 0xE0, 0x2A];				// ldc.i4.0, conv.u, ret
		case ElementType.ValueType: {
			var typeDef = (returnType as ValueTypeSig)?.TypeDefOrRef?.ResolveTypeDef();
			if (typeDef is { IsEnum: true }) {
				var underlying = typeDef.GetEnumUnderlyingType().RemovePinnedAndModifiers();
				var elementType = underlying.ElementType;
				if ((ElementType.Boolean <= elementType && elementType <= ElementType.R8) || elementType is ElementType.I or ElementType.U)
					return GetEmptyBody(underlying, level + 1);
			}
			return null;
		}
		case ElementType.GenericInst when ((GenericInstSig)returnType).GenericType is ValueTypeSig:
			return null;									// a struct/generic value type: same refusal as above
		case ElementType.TypedByRef:
		case ElementType.Var:
		case ElementType.MVar:
			return null;
		default:
			return [0x0A, 0x14, 0x2A];						// stloc.0, ldnull, ret
		}
	}
}
