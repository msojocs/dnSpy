using dnlib.DotNet;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core.Editing;

/// <summary>
/// Converts a <c>DeclSecurity</c> row — a declarative security demand, link demand or inheritance demand
/// on a type, method or assembly — to and from its DTO.
/// </summary>
/// <remarks>
/// A row carries either the modern form, a list of security attributes whose values are all named fields
/// and properties, or the .NET 1.x XML the older compilers emitted. Both travel, because a row that still
/// has the XML has to keep it: rewriting it as attributes would change what the runtime demands.
/// </remarks>
public sealed class DeclSecurityCodec {
	readonly EditContext context;

	internal DeclSecurityCodec(EditContext context) => this.context = context;

	public DeclSecurityDto ToDto(DeclSecurity? security) => security is null
		? throw SignatureCodec.Invalid("A security declaration is required.")
		: new DeclSecurityDto(
			(int)security.Action,
			[.. security.CustomAttributes.Select(context.Attributes.ToDto)],
			[.. security.SecurityAttributes.Select(ToDto)],
			security.GetNet1xXmlString(),
			Display(security));

	public DeclSecurity FromDto(DeclSecurityDto? dto) {
		if (dto is null)
			throw SignatureCodec.Invalid("A security declaration is required.");
		var security = context.Module.UpdateRowId(new DeclSecurityUser(
			(SecurityAction)dto.Action,
			// The two forms are one field in the metadata, so a row that still has the .NET 1.x XML is
			// written from it and the attributes the other form holds are not written at all — which is
			// `DeclSecurityOptions.CopyTo`, and what keeps an old row from being rewritten as a new one.
			dto.V1XmlString is { } xml
				? [SecurityAttribute.CreateFromXml(context.Module, xml)]
				: [.. (dto.SecurityAttributes ?? []).Select(FromDto)]));
		foreach (var attribute in context.Attributes.FromDtoList(dto.CustomAttributes))
			security.CustomAttributes.Add(attribute);
		return security;
	}

	public IReadOnlyList<DeclSecurityDto> ToDtoList(IEnumerable<DeclSecurity>? security) =>
		[.. (security ?? []).Select(ToDto)];

	public IList<DeclSecurity> FromDtoList(IEnumerable<DeclSecurityDto>? security) =>
		[.. (security ?? []).Select(FromDto)];

	SecurityAttributeDto ToDto(SecurityAttribute attribute) => new(
		context.Signatures.ToDtoRequired(attribute.AttributeType?.ToTypeSig()),
		[.. attribute.NamedArguments.Select(context.Attributes.ToDto)],
		attribute.TypeFullName ?? string.Empty);

	SecurityAttribute FromDto(SecurityAttributeDto dto) => new(
		context.Signatures.FromDtoRequired(dto.AttributeType).ToTypeDefOrRef(),
		[.. (dto.NamedArguments ?? []).Select(context.Attributes.FromDto)]);

	static string Display(DeclSecurity security) => security.Action.ToString();
}
