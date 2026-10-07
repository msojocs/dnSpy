using System.Globalization;
using ICorDebugSharp;
using ICorDebugSharp.Extensions;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// Turns an <see cref="ICorDebugValue"/> into the text the client shows.
/// </summary>
/// <remarks>
/// The runtime hands out values without symbols, so the formatter reads what the raw value carries:
/// the element type, the bytes of a primitive, the length and contents of a string, and the shape of
/// an array. A reference is followed to the object it points at, which is how a <c>string</c> local
/// reads as text instead of as an address. Objects are not expanded — reading their fields needs
/// metadata the runtime does not hand over — so they show as their declared type.
/// </remarks>
internal sealed class ManagedValueFormatter {
	const int MaxStringLength = 512;

	readonly VariableTable table;

	public ManagedValueFormatter(VariableTable table) => this.table = table;

	/// <summary>The DAP fields a value contributes: what it reads as, its runtime type, and its children.</summary>
	public sealed record FormattedValue(string Text, string? TypeName, int VariablesReference);

	public FormattedValue Format(ICorDebugValue? value) {
		if (value is null)
			return new FormattedValue(string.Empty, null, 0);
		try {
			return FormatCore(value);
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			// The value outlived the stop it belonged to.
			return new FormattedValue("<unavailable>", null, 0);
		}
	}

	FormattedValue FormatCore(ICorDebugValue value) {
		if (value is ICorDebugReferenceValue reference) {
			if (reference.IsNull)
				return new FormattedValue("null", null, 0);
			var target = reference.Dereference();
			// A reference whose object is gone reads as null too: that is what the debuggee sees.
			return target is null ? new FormattedValue("null", null, 0) : FormatCore(target);
		}
		if (value is ICorDebugStringValue text)
			return FormatString(text);
		if (value is ICorDebugArrayValue array)
			return FormatArray(array);
		if (value is ICorDebugGenericValue)
			return FormatPrimitive(value);
		// An object or a boxed value: naming it needs metadata, so the declared type is all there is.
		return new FormattedValue("{object}", null, 0);
	}

	FormattedValue FormatString(ICorDebugStringValue value) {
		var length = (int)value.Length;
		var contents = value.String ?? string.Empty;
		var truncated = contents.Length > MaxStringLength;
		if (truncated)
			contents = contents[..MaxStringLength];
		return new FormattedValue($"\"{contents}\"{(truncated ? "…" : string.Empty)}", $"string (length {length.ToString(CultureInfo.InvariantCulture)})", 0);
	}

	FormattedValue FormatArray(ICorDebugArrayValue value) {
		var count = (int)value.Count;
		var element = NameOfElementType(value.ElementType);
		var reference = count == 0 ? 0 : table.Add(new ArrayEntry(value, count));
		return new FormattedValue($"{{{element}[{count.ToString(CultureInfo.InvariantCulture)}]}}", $"{element}[]", reference);
	}

	FormattedValue FormatPrimitive(ICorDebugValue value) {
		var element = value.Type;
		return new FormattedValue(DescribePrimitive(ReadBytes(value), element), NameOfElementType(element), 0);
	}

	/// <summary>The raw bytes behind a primitive, which is as much as the runtime hands over.</summary>
	static byte[] ReadBytes(ICorDebugValue value) {
		var size = Math.Max((int)value.Size, 1);
		var bytes = new byte[size];
		unsafe {
			fixed (byte* pointer = bytes)
				((ICorDebugGenericValue)value).GetValue((IntPtr)pointer);
		}
		return bytes;
	}

	static string DescribePrimitive(byte[] bytes, CorElementType element) {
		// The buffer is exactly the value's size, so a wider read is only used when the bytes are there.
		var wide = bytes.Length >= 8;
		return element switch {
			CorElementType.BOOLEAN => bytes[0] != 0 ? "true" : "false",
			CorElementType.CHAR => $"'{DescribeChar((char)BitConverter.ToUInt16(bytes, 0))}'",
			CorElementType.I1 => ((sbyte)bytes[0]).ToString(CultureInfo.InvariantCulture),
			CorElementType.U1 => bytes[0].ToString(CultureInfo.InvariantCulture),
			CorElementType.I2 => BitConverter.ToInt16(bytes, 0).ToString(CultureInfo.InvariantCulture),
			CorElementType.U2 => BitConverter.ToUInt16(bytes, 0).ToString(CultureInfo.InvariantCulture),
			CorElementType.I4 => BitConverter.ToInt32(bytes, 0).ToString(CultureInfo.InvariantCulture),
			CorElementType.U4 => BitConverter.ToUInt32(bytes, 0).ToString(CultureInfo.InvariantCulture),
			CorElementType.I8 => BitConverter.ToInt64(bytes, 0).ToString(CultureInfo.InvariantCulture),
			CorElementType.U8 => BitConverter.ToUInt64(bytes, 0).ToString(CultureInfo.InvariantCulture),
			CorElementType.R4 => BitConverter.ToSingle(bytes, 0).ToString("R", CultureInfo.InvariantCulture),
			CorElementType.R8 => BitConverter.ToDouble(bytes, 0).ToString("R", CultureInfo.InvariantCulture),
			CorElementType.I => (wide ? BitConverter.ToInt64(bytes, 0) : BitConverter.ToInt32(bytes, 0)).ToString(CultureInfo.InvariantCulture),
			CorElementType.U => (wide ? BitConverter.ToUInt64(bytes, 0) : BitConverter.ToUInt32(bytes, 0)).ToString(CultureInfo.InvariantCulture),
			CorElementType.PTR or CorElementType.FNPTR => "0x" + Convert.ToHexString(bytes),
			_ => "0x" + Convert.ToHexString(bytes),
		};
	}

	static string DescribeChar(char value) => value switch {
		'\'' => "\\'",
		'\\' => "\\\\",
		'\0' => "\\0",
		'\n' => "\\n",
		'\r' => "\\r",
		'\t' => "\\t",
		_ => char.IsControl(value) ? $"\\u{(int)value:X4}" : value.ToString(),
	};

	/// <summary>The C# spelling of an element type, which is what the client shows beside a value.</summary>
	static string NameOfElementType(CorElementType element) => element switch {
		CorElementType.BOOLEAN => "bool",
		CorElementType.CHAR => "char",
		CorElementType.I1 => "sbyte",
		CorElementType.U1 => "byte",
		CorElementType.I2 => "short",
		CorElementType.U2 => "ushort",
		CorElementType.I4 => "int",
		CorElementType.U4 => "uint",
		CorElementType.I8 => "long",
		CorElementType.U8 => "ulong",
		CorElementType.R4 => "float",
		CorElementType.R8 => "double",
		CorElementType.I => "nint",
		CorElementType.U => "nuint",
		CorElementType.STRING => "string",
		CorElementType.PTR or CorElementType.FNPTR => "pointer",
		_ => "object",
	};

	/// <summary>
	/// The same value, as the breakpoint expression evaluator understands it. A condition compares
	/// values rather than printing them, so a primitive comes back as a number instead of as the text
	/// of one, and anything the engine cannot look inside comes back opaque — comparable only to null.
	/// </summary>
	public BreakpointValue ReadValue(ICorDebugValue? value) {
		if (value is null)
			return BreakpointValue.Null;
		try {
			return ReadValueCore(value);
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			return BreakpointValue.FromObject("<unavailable>");
		}
	}

	BreakpointValue ReadValueCore(ICorDebugValue value) {
		if (value is ICorDebugReferenceValue reference) {
			if (reference.IsNull)
				return BreakpointValue.Null;
			var target = reference.Dereference();
			return target is null ? BreakpointValue.Null : ReadValueCore(target);
		}
		if (value is ICorDebugStringValue text)
			return BreakpointValue.FromString(text.String ?? string.Empty);
		if (value is ICorDebugArrayValue array)
			return BreakpointValue.FromObject(FormatArray(array).Text);
		if (value is ICorDebugGenericValue)
			return ReadPrimitive(value);
		return BreakpointValue.FromObject("{object}");
	}

	static BreakpointValue ReadPrimitive(ICorDebugValue value) {
		var element = value.Type;
		var bytes = ReadBytes(value);
		var wide = bytes.Length >= 8;
		return element switch {
			CorElementType.BOOLEAN => BreakpointValue.FromBool(bytes[0] != 0),
			// A char reads as its code point, so both `c == 'x'` and `c == 120` work.
			CorElementType.CHAR => BreakpointValue.FromInteger(BitConverter.ToUInt16(bytes, 0)),
			CorElementType.I1 => BreakpointValue.FromInteger((sbyte)bytes[0]),
			CorElementType.U1 => BreakpointValue.FromInteger(bytes[0]),
			CorElementType.I2 => BreakpointValue.FromInteger(BitConverter.ToInt16(bytes, 0)),
			CorElementType.U2 => BreakpointValue.FromInteger(BitConverter.ToUInt16(bytes, 0)),
			CorElementType.I4 => BreakpointValue.FromInteger(BitConverter.ToInt32(bytes, 0)),
			CorElementType.U4 => BreakpointValue.FromInteger(BitConverter.ToUInt32(bytes, 0)),
			CorElementType.I8 => BreakpointValue.FromInteger(BitConverter.ToInt64(bytes, 0)),
			CorElementType.U8 => BreakpointValue.FromUnsigned(BitConverter.ToUInt64(bytes, 0)),
			CorElementType.R4 => BreakpointValue.FromFloating(BitConverter.ToSingle(bytes, 0)),
			CorElementType.R8 => BreakpointValue.FromFloating(BitConverter.ToDouble(bytes, 0)),
			CorElementType.I => BreakpointValue.FromInteger(wide ? BitConverter.ToInt64(bytes, 0) : BitConverter.ToInt32(bytes, 0)),
			CorElementType.U => BreakpointValue.FromUnsigned(wide ? BitConverter.ToUInt64(bytes, 0) : BitConverter.ToUInt32(bytes, 0)),
			_ => BreakpointValue.FromObject(DescribePrimitive(bytes, element)),
		};
	}

	/// <summary>The children of a value the client expanded, named the way an array's are.</summary>
	public IReadOnlyList<(string Name, ICorDebugValue Value)> Children(VariableEntry entry) {
		if (entry is not ArrayEntry array)
			return Array.Empty<(string, ICorDebugValue)>();
		var children = new List<(string, ICorDebugValue)>(array.Count);
		for (var index = 0; index < array.Count; index++) {
			try {
				var element = array.Value.GetElementAtPosition(index);
				if (element is not null)
					children.Add(($"[{index.ToString(CultureInfo.InvariantCulture)}]", element));
			}
			catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
				// An element the runtime refuses to hand over; the rest of the array still lists.
			}
		}
		return children;
	}
}
