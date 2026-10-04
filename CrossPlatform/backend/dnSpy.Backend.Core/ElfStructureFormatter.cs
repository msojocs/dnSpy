using System.Globalization;
using System.Text;

namespace dnSpy.Backend.Core;

/// <summary>
/// Writes the fields of one ELF structure. This is the document a structure node shows, and it reads the
/// same way <see cref="PeStructureFormatter"/> does for a PE image: the file range the structure covers,
/// then one line per field. The names of the values come from <see cref="ElfNames"/>.
/// </summary>
internal static class ElfStructureFormatter {
	/// <summary>
	/// The name the tree shows for a structure node. It is derived from the image rather than stored on the
	/// node, so a section's name is always the one the file's own string table holds.
	/// </summary>
	public static string Label(ElfImage image, ElfStructureKind kind, int index) => kind switch {
		ElfStructureKind.FileHeader => "ELF Header",
		ElfStructureKind.ProgramHeader => $"Program Header #{index}",
		ElfStructureKind.SectionHeader => DescribeSection(image, index),
		_ => kind.ToString(),
	};

	/// <summary>
	/// The document of one structure node. An index that names nothing writes nothing, since a node for it
	/// is never created either.
	/// </summary>
	public static void Append(StringBuilder builder, ElfImage image, ElfStructureKind kind, int index) {
		switch (kind) {
		case ElfStructureKind.FileHeader:
			AppendFileHeader(builder, image);
			break;
		case ElfStructureKind.ProgramHeader:
			AppendProgramHeader(builder, image, index);
			break;
		case ElfStructureKind.SectionHeader:
			AppendSectionHeader(builder, image, index);
			break;
		}
	}

	static void AppendFileHeader(StringBuilder builder, ElfImage image) {
		var header = image.Header;
		var digits = header.Is64Bit ? 16 : 8;
		AppendHeader(builder, 0, header.HeaderSize, "ELF Header");
		Field(builder, "Class", ElfNames.DescribeClass(header.Is64Bit));
		Field(builder, "Data", ElfNames.DescribeData(header.IsLittleEndian));
		Field(builder, "OS/ABI", ElfNames.DescribeOsAbi(header.OsAbi));
		Field(builder, "ABI Version", header.AbiVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "Type", $"0x{header.Type:X4} ({ElfNames.DescribeType(header.Type)})");
		Field(builder, "Machine", $"0x{header.Machine:X4} ({ElfNames.DescribeMachine(header.Machine)})");
		Field(builder, "Version", $"0x{header.Version:X8}");
		Field(builder, "EntryPointAddress", Hex(header.EntryPoint, digits));
		Field(builder, "StartOfProgramHeaders", header.ProgramHeaderOffset.ToString(CultureInfo.InvariantCulture));
		Field(builder, "StartOfSectionHeaders", header.SectionHeaderOffset.ToString(CultureInfo.InvariantCulture));
		Field(builder, "Flags", $"0x{header.Flags:X8}");
		Field(builder, "SizeOfThisHeader", header.HeaderSize.ToString(CultureInfo.InvariantCulture));
		Field(builder, "SizeOfProgramHeaders", header.ProgramHeaderEntrySize.ToString(CultureInfo.InvariantCulture));
		Field(builder, "NumberOfProgramHeaders", header.ProgramHeaderCount.ToString(CultureInfo.InvariantCulture));
		Field(builder, "SizeOfSectionHeaders", header.SectionHeaderEntrySize.ToString(CultureInfo.InvariantCulture));
		Field(builder, "NumberOfSectionHeaders", header.SectionHeaderCount.ToString(CultureInfo.InvariantCulture));
		Field(builder, "SectionHeaderStringTableIndex", header.SectionNameTableIndex.ToString(CultureInfo.InvariantCulture));
	}

	static void AppendProgramHeader(StringBuilder builder, ElfImage image, int index) {
		if (index < 0 || index >= image.ProgramHeaders.Count)
			return;
		var header = image.ProgramHeaders[index];
		var digits = image.Header.Is64Bit ? 16 : 8;
		var start = image.Header.ProgramHeaderOffset + (ulong)(index * image.Header.ProgramHeaderEntrySize);
		AppendHeader(builder, start, start + image.Header.ProgramHeaderEntrySize, Label(image, ElfStructureKind.ProgramHeader, index));
		Field(builder, "Type", $"0x{header.Type:X8} ({ElfNames.DescribeProgramHeaderType(header.Type)})");
		Field(builder, "Flags", $"0x{header.Flags:X8} ({ElfNames.DescribeProgramHeaderFlags(header.Flags)})");
		Field(builder, "Offset", Hex(header.Offset, digits));
		Field(builder, "VirtualAddress", Hex(header.VirtualAddress, digits));
		Field(builder, "PhysicalAddress", Hex(header.PhysicalAddress, digits));
		Field(builder, "FileSize", Hex(header.FileSize, digits));
		Field(builder, "MemorySize", Hex(header.MemorySize, digits));
		Field(builder, "Align", Hex(header.Alignment, digits));
	}

	static void AppendSectionHeader(StringBuilder builder, ElfImage image, int index) {
		if (index < 0 || index >= image.Sections.Count)
			return;
		var section = image.Sections[index];
		var digits = image.Header.Is64Bit ? 16 : 8;
		var start = image.Header.SectionHeaderOffset + (ulong)(index * image.Header.SectionHeaderEntrySize);
		AppendHeader(builder, start, start + image.Header.SectionHeaderEntrySize, Label(image, ElfStructureKind.SectionHeader, index));
		Field(builder, "Name", section.Name.Length == 0 ? "-" : section.Name);
		Field(builder, "Type", $"0x{section.Type:X8} ({ElfNames.DescribeSectionType(section.Type)})");
		Field(builder, "Flags", $"0x{section.Flags:X16} ({ElfNames.DescribeSectionFlags(section.Flags)})");
		Field(builder, "Address", Hex(section.Address, digits));
		Field(builder, "Offset", Hex(section.Offset, digits));
		Field(builder, "Size", Hex(section.Size, digits));
		Field(builder, "Link", section.Link.ToString(CultureInfo.InvariantCulture));
		Field(builder, "Info", section.Info.ToString(CultureInfo.InvariantCulture));
		Field(builder, "AddressAlignment", section.Alignment.ToString(CultureInfo.InvariantCulture));
		Field(builder, "EntrySize", section.EntrySize.ToString(CultureInfo.InvariantCulture));
	}

	/// <summary>A section is named by the file, and section 0 has no name at all.</summary>
	static string DescribeSection(ElfImage image, int index) {
		var name = index >= 0 && index < image.Sections.Count ? image.Sections[index].Name : string.Empty;
		return name.Length == 0 ? $"Section #{index}" : $"Section #{index}: {name}";
	}

	static string Hex(ulong value, int digits) => $"0x{value.ToString("X" + digits.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture)}";

	static void Field(StringBuilder builder, string name, string value) => builder.AppendLine($"{name + ":",-22}{value}");

	/// <summary>
	/// The file range a structure covers, written the way the PE structures introduce theirs: the start offset
	/// and the last byte the structure occupies, both inclusive.
	/// </summary>
	static void AppendHeader(StringBuilder builder, ulong start, ulong end, string label) =>
		builder.AppendLine($"// {start:X8} - {end - 1:X8} {label}");
}
