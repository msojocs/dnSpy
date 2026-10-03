using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Converts a <c>Constant</c> row — a field's default value, a parameter's default value, a property's
/// default value — to and from its DTO.
/// </summary>
/// <remarks>
/// The value travels as invariant text because the row's own element type says how to read it back, and
/// text is the one representation that keeps every width of every literal intact through JSON. A row
/// whose element type cannot hold a literal — <c>System.Object</c>, say — reads back as null, which is
/// the same thing the dialog shows when it has nothing to put in the value box.
/// </remarks>
public sealed class ConstantCodec {
	readonly EditContext context;

	internal ConstantCodec(EditContext context) => this.context = context;

	public ConstantDto? ToDto(Constant? constant) => constant is null
		? null
		: new ConstantDto(
			(int)constant.Type,
			constant.Value is null ? null : DnlibDisplay.LiteralText(constant.Value),
			DnlibDisplay.Constant(constant));

	/// <summary>
	/// Rebuilds a constant. A row with no element type and no value is dropped rather than written as an
	/// empty row, which is how a dialog says "this field has no default value".
	/// </summary>
	public Constant? FromDto(ConstantDto? dto) {
		if (dto is null)
			return null;
		var elementType = (ElementType)dto.ElementType;
		if (dto.Value is null && elementType is ElementType.End or ElementType.Void or ElementType.Class)
			return null;
		// A constant is a metadata row like any other, so it takes its row id here rather than at save
		// time — the same thing dnSpy does when it rebuilds one from the dialog.
		return context.Module.UpdateRowId(
			new ConstantUser(DnlibDisplay.ParseLiteral(elementType, dto.Value), elementType));
	}
}
