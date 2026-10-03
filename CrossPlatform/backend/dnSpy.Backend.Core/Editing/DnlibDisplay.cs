using System.Globalization;
using System.Text;
using dnlib.DotNet;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// The text the edit dialogs show for a model object, and the conversions between a boxed literal and
/// the invariant text the DTOs carry it in.
/// </summary>
/// <remarks>
/// Every name here is dnlib's own <c>FullName</c> — the same text the assembly explorer and the IL view
/// already print — so a type or a method reads the same in a dialog as it does everywhere else in the
/// port. The WPF client renders type signatures through the selected decompiler instead and so shows
/// <c>int[]</c> where this shows <c>System.Int32[]</c>; that formatter lives in the decompiler's output
/// visitor and would tie every dialog to a decompiler instance, while the dialogs only ever display the
/// string and never parse it back.
/// </remarks>
public static class DnlibDisplay {
	public static string Type(TypeSig? signature) => signature?.FullName ?? "null";

	/// <summary>
	/// A method signature, written the way dnlib's own <c>FullName</c> writes a method: the return type
	/// followed by the parameter list. Property signatures go through the same method, since a property
	/// signature is a method signature whose "return type" is the property's type.
	/// </summary>
	public static string Method(MethodBaseSig? signature) {
		if (signature is null)
			return "null";
		var builder = new StringBuilder();
		builder.Append(Type(signature.RetType)).Append('(');
		for (var i = 0; i < signature.Params.Count; i++) {
			if (i > 0)
				builder.Append(',');
			builder.Append(Type(signature.Params[i]));
		}
		if (signature.ParamsAfterSentinel is { Count: > 0 } afterSentinel) {
			builder.Append(",...");
			for (var i = 0; i < afterSentinel.Count; i++) {
				if (i > 0)
					builder.Append(',');
				builder.Append(Type(afterSentinel[i]));
			}
		}
		return builder.Append(')').ToString();
	}

	public static string Constant(Constant? constant) =>
		constant is null ? "null" : LiteralText(constant.Value);

	/// <summary>
	/// Writes a boxed custom-attribute or constant literal as invariant text. Numbers and characters use
	/// the round-trippable form so that a value survives the trip out to the client and back unchanged.
	/// </summary>
	public static string LiteralText(object? value) => value switch {
		null => "null",
		bool boolean => boolean ? "true" : "false",
		string text => text,
		UTF8String text => text.String,
		char character => character.ToString(),
		// "R" is only a valid format for the two floating-point types; the integral ones take the
		// default format, which is already round-trippable for them.
		float single => single.ToString("R", CultureInfo.InvariantCulture),
		double double_ => double_.ToString("R", CultureInfo.InvariantCulture),
		IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
		_ => value.ToString() ?? string.Empty,
	};

	/// <summary>
	/// Reads back what <see cref="LiteralText"/> wrote, given the element type of the literal. Returns
	/// null for an element type that cannot hold a literal, which is how a dialog asking for a constant
	/// on something like <c>System.Object</c> reports that there is nothing to store.
	/// </summary>
	public static object? ParseLiteral(ElementType elementType, string? text) {
		if (text is null)
			return null;
		return elementType switch {
			ElementType.Boolean => text == "true",
			ElementType.Char => text.Length > 0 ? text[0] : '\0',
			ElementType.I1 => sbyte.Parse(text, NumberStyles.Integer, CultureInfo.InvariantCulture),
			ElementType.U1 => byte.Parse(text, NumberStyles.Integer, CultureInfo.InvariantCulture),
			ElementType.I2 => short.Parse(text, NumberStyles.Integer, CultureInfo.InvariantCulture),
			ElementType.U2 => ushort.Parse(text, NumberStyles.Integer, CultureInfo.InvariantCulture),
			ElementType.I4 => int.Parse(text, NumberStyles.Integer, CultureInfo.InvariantCulture),
			ElementType.U4 => uint.Parse(text, NumberStyles.Integer, CultureInfo.InvariantCulture),
			ElementType.I8 => long.Parse(text, NumberStyles.Integer, CultureInfo.InvariantCulture),
			ElementType.U8 => ulong.Parse(text, NumberStyles.Integer, CultureInfo.InvariantCulture),
			ElementType.R4 => float.Parse(text, NumberStyles.Float, CultureInfo.InvariantCulture),
			ElementType.R8 => double.Parse(text, NumberStyles.Float, CultureInfo.InvariantCulture),
			ElementType.String => new UTF8String(text),
			_ => null,
		};
	}

	/// <summary>
	/// The literal a constant of this element type starts at. dnSpy gives a field it creates on an enum
	/// this value, because a <c>Literal</c> field has to carry a constant and there is no other default.
	/// </summary>
	public static object? DefaultValue(ElementType elementType) => elementType switch {
		ElementType.Boolean => false,
		ElementType.Char => (char)0,
		ElementType.I1 => (sbyte)0,
		ElementType.U1 => (byte)0,
		ElementType.I2 => (short)0,
		ElementType.U2 => (ushort)0,
		ElementType.I4 => 0,
		ElementType.U4 => 0u,
		ElementType.I8 => 0L,
		ElementType.U8 => 0UL,
		ElementType.R4 => 0f,
		ElementType.R8 => 0d,
		_ => null,
	};

	/// <summary>The element type a literal of this runtime type is stored as.</summary>
	public static ElementType ElementTypeOf(object? value) => value switch {
		null => ElementType.Class,
		bool => ElementType.Boolean,
		char => ElementType.Char,
		sbyte => ElementType.I1,
		byte => ElementType.U1,
		short => ElementType.I2,
		ushort => ElementType.U2,
		int => ElementType.I4,
		uint => ElementType.U4,
		long => ElementType.I8,
		ulong => ElementType.U8,
		float => ElementType.R4,
		double => ElementType.R8,
		string or UTF8String => ElementType.String,
		_ => ElementType.Class,
	};

	/// <summary>
	/// The underlying element type of a value stored in <paramref name="signature"/>: a primitive is its
	/// own element type, and an enum — whose declared type is the enum but whose boxed value is always a
	/// primitive — is the element type of its underlying field, <c>value__</c>.
	/// </summary>
	public static ElementType UnderlyingElementType(TypeSig? signature) {
		var type = signature?.RemovePinnedAndModifiers();
		if (type is null)
			return ElementType.End;
		if (type is ClassOrValueTypeSig named && named.TypeDefOrRef.ResolveTypeDef() is { IsEnum: true } enumType)
			return enumType.GetEnumUnderlyingType().RemovePinnedAndModifiers().ElementType;
		return type.ElementType;
	}
}
