using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Converts a field's or parameter's <c>MarshalType</c> to and from its DTO.
/// </summary>
/// <remarks>
/// dnlib models the row as a family of subclasses chosen by <c>NativeType</c>, and each subclass answers
/// for itself whether a payload field is present at all — <c>IsSizeValid</c>, <c>IsParamNumberValid</c> and
/// the rest. A field that is not present travels as null, and null is written back as the sentinel dnlib
/// uses for "absent" (<c>-1</c>), so a marshal type that never had a size does not gain one.
/// </remarks>
public sealed class MarshalTypeCodec {
	readonly EditContext context;

	internal MarshalTypeCodec(EditContext context) => this.context = context;

	public MarshalTypeDto? ToDto(MarshalType? marshalType) => marshalType switch {
		null => null,
		RawMarshalType raw => new MarshalTypeDto(
			(int)raw.NativeType, RawData: Convert.ToBase64String(raw.Data ?? []), Display: Display(raw)),
		FixedSysStringMarshalType fixedString => new MarshalTypeDto(
			(int)fixedString.NativeType,
			Size: fixedString.IsSizeValid ? (int)fixedString.Size : null,
			Display: Display(fixedString)),
		SafeArrayMarshalType safeArray => new MarshalTypeDto(
			(int)safeArray.NativeType,
			VariantType: (int)safeArray.VariantType,
			UserDefinedSubType: safeArray.IsUserDefinedSubTypeValid && safeArray.UserDefinedSubType is { } userType
				? context.Signatures.ToDto(userType.ToTypeSig())
				: null,
			Display: Display(safeArray)),
		FixedArrayMarshalType fixedArray => new MarshalTypeDto(
			(int)fixedArray.NativeType,
			Size: fixedArray.IsSizeValid ? (int)fixedArray.Size : null,
			ElementType: fixedArray.IsElementTypeValid ? (int)fixedArray.ElementType : null,
			Display: Display(fixedArray)),
		ArrayMarshalType array => new MarshalTypeDto(
			(int)array.NativeType,
			Size: array.IsSizeValid ? (int)array.Size : null,
			ElementType: array.IsElementTypeValid ? (int)array.ElementType : null,
			ParamNumber: array.IsParamNumberValid ? (int)array.ParamNumber : null,
			Flags: array.IsFlagsValid ? (int)array.Flags : null,
			Display: Display(array)),
		CustomMarshalType custom => new MarshalTypeDto(
			(int)custom.NativeType,
			UserDefinedSubType: custom.CustomMarshaler is null ? null : context.Signatures.ToDto(custom.CustomMarshaler.ToTypeSig()),
			Guid: custom.Guid?.String,
			NativeTypeName: custom.NativeTypeName?.String,
			Cookie: custom.Cookie?.String,
			Display: Display(custom)),
		InterfaceMarshalType @interface => new MarshalTypeDto(
			(int)@interface.NativeType,
			IidParamIndex: @interface.IsIidParamIndexValid ? @interface.IidParamIndex : null,
			Display: Display(@interface)),
		_ => new MarshalTypeDto((int)marshalType.NativeType, Display: Display(marshalType)),
	};

	public MarshalType? FromDto(MarshalTypeDto? dto) {
		if (dto is null)
			return null;
		var nativeType = (NativeType)dto.NativeType;
		return nativeType switch {
			NativeType.RawBlob => new RawMarshalType(dto.RawData is null ? [] : Convert.FromBase64String(dto.RawData)),
			NativeType.FixedSysString => new FixedSysStringMarshalType(dto.Size ?? Absent),
			NativeType.SafeArray => BuildSafeArray(dto),
			NativeType.FixedArray => new FixedArrayMarshalType(
				dto.Size ?? Absent,
				dto.ElementType is { } element ? (NativeType)element : NativeType.NotInitialized),
			NativeType.Array => new ArrayMarshalType(
				dto.ElementType is { } element ? (NativeType)element : NativeType.NotInitialized,
				dto.ParamNumber ?? Absent,
				dto.Size ?? Absent,
				dto.Flags ?? Absent),
			NativeType.CustomMarshaler => new CustomMarshalType(
				dto.Guid is null ? null : new UTF8String(dto.Guid),
				dto.NativeTypeName is null ? null : new UTF8String(dto.NativeTypeName),
				dto.UserDefinedSubType is null ? null : context.Signatures.FromDtoRequired(dto.UserDefinedSubType).ToTypeDefOrRef(),
				dto.Cookie is null ? null : new UTF8String(dto.Cookie)),
			NativeType.IUnknown or NativeType.IDispatch or NativeType.IntF => new InterfaceMarshalType(
				nativeType,
				dto.IidParamIndex ?? Absent),
			_ => new MarshalType(nativeType),
		};
	}

	/// <summary>
	/// The sentinel dnlib reads as "this field is not present". Its validity properties are all of the
	/// form "greater than or equal to zero", so a negative value is what says there is nothing here.
	/// </summary>
	const int Absent = -1;

	/// <summary>
	/// A safe array's variant type is a bit field whose top bits carry a user-defined element type, so
	/// the element type is only written when the signature that names it is there as well.
	/// </summary>
	MarshalType BuildSafeArray(MarshalTypeDto dto) {
		var variantType = dto.VariantType is { } value ? (VariantType)value : VariantType.NotInitialized;
		return dto.UserDefinedSubType is null
			? new SafeArrayMarshalType(variantType)
			: new SafeArrayMarshalType(variantType, context.Signatures.FromDtoRequired(dto.UserDefinedSubType).ToTypeDefOrRef());
	}

	static string Display(MarshalType marshalType) => marshalType.NativeType.ToString();
}
