using System.Globalization;
using System.Text;
using dnlib.IO;
using dnlib.PE;

namespace dnSpy.Backend.Core;

/// <summary>
/// Writes the fields of one PE structure. This is the document a PE structure node shows, and it reads the
/// same way dnSpy's AsmEditor hex nodes do (dnSpy.AsmEditor.Hex.Nodes.HexNode): the file range the structure
/// covers, then one line per field. The values that are not numbers come from <see cref="PeImageInfo"/>.
/// </summary>
internal static class PeStructureFormatter {
	/// <summary>
	/// The name the tree shows for a structure node. It is derived from the image rather than stored on the
	/// node, so a section's name and a stream's name are always the ones the file actually holds.
	/// </summary>
	public static string Label(PeStructureSource source, PeStructureKind kind, int index) => kind switch {
		PeStructureKind.DosHeader => "DOS Header",
		PeStructureKind.FileHeader => "File Header",
		PeStructureKind.OptionalHeader => DescribeOptionalHeader(source.Image),
		PeStructureKind.Section => DescribeSection(source.Image, index),
		PeStructureKind.Cor20Header => "Cor20 Header",
		PeStructureKind.StorageSignature => "Storage Signature",
		PeStructureKind.StorageHeader => "Storage Header",
		PeStructureKind.StorageStream => $"Storage Stream #{index}: {GetStreamName(source, index)}",
		_ => kind.ToString(),
	};

	/// <summary>
	/// The document of one structure node. The stream kinds come back empty when the file has no metadata to
	/// read them from, since a node for them is never created then either.
	/// </summary>
	public static void Append(StringBuilder builder, PeStructureSource source, PeStructureKind kind, int index) {
		switch (kind) {
		case PeStructureKind.DosHeader:
			AppendDosHeader(builder, source.Image);
			break;
		case PeStructureKind.FileHeader:
			AppendFileHeader(builder, source.Image);
			break;
		case PeStructureKind.OptionalHeader:
			AppendOptionalHeader(builder, source.Image);
			break;
		case PeStructureKind.Section:
			AppendSection(builder, source.Image, index);
			break;
		case PeStructureKind.Cor20Header:
			AppendCor20Header(builder, source);
			break;
		case PeStructureKind.StorageSignature:
			AppendStorageSignature(builder, source);
			break;
		case PeStructureKind.StorageHeader:
			AppendStorageHeader(builder, source);
			break;
		case PeStructureKind.StorageStream:
			AppendStorageStream(builder, source, index);
			break;
		}
	}

	/// <summary>
	/// dnlib models the DOS header as a bare range, so its fields are read straight out of the file the way
	/// the hex editor shows them.
	/// </summary>
	static void AppendDosHeader(StringBuilder builder, PEImage peImage) {
		var header = peImage.ImageDosHeader;
		AppendHeader(builder, header.StartOffset, header.EndOffset, "DOS Header");
		var reader = peImage.CreateReader();
		reader.Position = 0;
		var magic = reader.ReadUInt16();
		Field(builder, "e_magic", $"0x{magic:X4} ({(magic == 0x5A4D ? "MZ" : "INVALID")})");
		Field(builder, "e_cblp", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_cp", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_crlc", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_cparhdr", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_minalloc", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_maxalloc", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_ss", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_sp", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_csum", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_ip", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_cs", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_lfarlc", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_ovno", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_res", Convert.ToHexString(reader.ReadBytes(8)));
		Field(builder, "e_oemid", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_oeminfo", $"0x{reader.ReadUInt16():X4}");
		Field(builder, "e_res2", Convert.ToHexString(reader.ReadBytes(20)));
		reader.Position = 0x3C;
		Field(builder, "e_lfanew", $"0x{reader.ReadUInt32():X8}");
	}

	static void AppendFileHeader(StringBuilder builder, PEImage peImage) {
		var header = peImage.ImageNTHeaders.FileHeader;
		AppendHeader(builder, header.StartOffset, header.EndOffset, "File Header");
		Field(builder, "Machine", $"0x{(ushort)header.Machine:X4} ({PeImageInfo.DescribeMachine(header.Machine)})");
		Field(builder, "NumberOfSections", header.NumberOfSections.ToString(CultureInfo.InvariantCulture));
		Field(builder, "TimeDateStamp", DescribeTimestamp(header.TimeDateStamp));
		Field(builder, "PointerToSymbolTable", $"0x{header.PointerToSymbolTable:X8}");
		Field(builder, "NumberOfSymbols", header.NumberOfSymbols.ToString(CultureInfo.InvariantCulture));
		Field(builder, "SizeOfOptionalHeader", $"0x{header.SizeOfOptionalHeader:X4}");
		Field(builder, "Characteristics", $"0x{(uint)header.Characteristics:X4} ({PeImageInfo.DescribeFlags(header.Characteristics)})");
	}

	static void AppendOptionalHeader(StringBuilder builder, PEImage peImage) {
		var header = peImage.ImageNTHeaders.OptionalHeader;
		var fileHeader = peImage.ImageNTHeaders.FileHeader;
		var start = Offset(fileHeader.EndOffset);
		AppendHeader(builder, start, start + fileHeader.SizeOfOptionalHeader - 1, DescribeOptionalHeader(peImage));
		var is64Bit = header.Magic == 0x20B;
		Field(builder, "Magic", $"0x{header.Magic:X4} ({(is64Bit ? "PE32+" : header.Magic == 0x10B ? "PE32" : "UNKNOWN")})");
		Field(builder, "MajorLinkerVersion", header.MajorLinkerVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "MinorLinkerVersion", header.MinorLinkerVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "SizeOfCode", $"0x{header.SizeOfCode:X8}");
		Field(builder, "SizeOfInitializedData", $"0x{header.SizeOfInitializedData:X8}");
		Field(builder, "SizeOfUninitializedData", $"0x{header.SizeOfUninitializedData:X8}");
		Field(builder, "AddressOfEntryPoint", $"0x{(uint)header.AddressOfEntryPoint:X8}");
		Field(builder, "BaseOfCode", $"0x{(uint)header.BaseOfCode:X8}");
		// BaseOfData only exists in a PE32 optional header; a 64-bit one has more stack and heap sizes here.
		if (!is64Bit)
			Field(builder, "BaseOfData", $"0x{(uint)header.BaseOfData:X8}");
		Field(builder, "ImageBase", $"0x{header.ImageBase:X8}");
		Field(builder, "SectionAlignment", $"0x{header.SectionAlignment:X8}");
		Field(builder, "FileAlignment", $"0x{header.FileAlignment:X8}");
		Field(builder, "MajorOperatingSystemVersion", header.MajorOperatingSystemVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "MinorOperatingSystemVersion", header.MinorOperatingSystemVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "MajorImageVersion", header.MajorImageVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "MinorImageVersion", header.MinorImageVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "MajorSubsystemVersion", header.MajorSubsystemVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "MinorSubsystemVersion", header.MinorSubsystemVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "Win32VersionValue", $"0x{header.Win32VersionValue:X8}");
		Field(builder, "SizeOfImage", $"0x{header.SizeOfImage:X8}");
		Field(builder, "SizeOfHeaders", $"0x{header.SizeOfHeaders:X8}");
		Field(builder, "CheckSum", $"0x{header.CheckSum:X8}");
		Field(builder, "Subsystem", $"0x{(ushort)header.Subsystem:X4} ({PeImageInfo.DescribeSubsystem(header.Subsystem)})");
		Field(builder, "DllCharacteristics", $"0x{(ushort)header.DllCharacteristics:X4} ({PeImageInfo.DescribeFlags(header.DllCharacteristics)})");
		Field(builder, "SizeOfStackReserve", $"0x{header.SizeOfStackReserve:X8}");
		Field(builder, "SizeOfStackCommit", $"0x{header.SizeOfStackCommit:X8}");
		Field(builder, "SizeOfHeapReserve", $"0x{header.SizeOfHeapReserve:X8}");
		Field(builder, "SizeOfHeapCommit", $"0x{header.SizeOfHeapCommit:X8}");
		Field(builder, "LoaderFlags", $"0x{header.LoaderFlags:X8}");
		Field(builder, "NumberOfRvaAndSizes", header.NumberOfRvaAndSizes.ToString(CultureInfo.InvariantCulture));
		AppendDataDirectories(builder, peImage);
	}

	static void AppendDataDirectories(StringBuilder builder, PEImage peImage) {
		var header = peImage.ImageNTHeaders.OptionalHeader;
		var directories = header.DataDirectories;
		if (directories.Length == 0)
			return;
		builder.AppendLine("DataDirectories:");
		for (var i = 0; i < directories.Length && i < header.NumberOfRvaAndSizes; i++)
			Field(builder, PeImageInfo.DescribeDataDirectory(i), DescribeDirectory(directories[i]));
	}

	static void AppendSection(StringBuilder builder, PEImage peImage, int index) {
		if (index < 0 || index >= peImage.ImageSectionHeaders.Count)
			return;
		var section = peImage.ImageSectionHeaders[index];
		AppendHeader(builder, section.StartOffset, section.EndOffset, DescribeSection(peImage, index));
		// DisplayName already carries the leading dot, the way the section name is stored in the file.
		Field(builder, "Name", section.DisplayName.TrimEnd());
		Field(builder, "VirtualSize", $"0x{section.VirtualSize:X8}");
		Field(builder, "VirtualAddress", $"0x{(uint)section.VirtualAddress:X8}");
		Field(builder, "SizeOfRawData", $"0x{section.SizeOfRawData:X8}");
		Field(builder, "PointerToRawData", $"0x{section.PointerToRawData:X8}");
		Field(builder, "PointerToRelocations", $"0x{section.PointerToRelocations:X8}");
		Field(builder, "PointerToLinenumbers", $"0x{section.PointerToLinenumbers:X8}");
		Field(builder, "NumberOfRelocations", section.NumberOfRelocations.ToString(CultureInfo.InvariantCulture));
		Field(builder, "NumberOfLinenumbers", section.NumberOfLinenumbers.ToString(CultureInfo.InvariantCulture));
		Field(builder, "Characteristics", $"0x{section.Characteristics:X8} ({PeImageInfo.DescribeSectionCharacteristics(section.Characteristics)})");
	}

	static void AppendCor20Header(StringBuilder builder, PeStructureSource source) {
		if (source.Metadata?.ImageCor20Header is not { } header)
			return;
		AppendHeader(builder, header.StartOffset, header.EndOffset, "Cor20 Header");
		Field(builder, "cb", $"0x{header.CB:X8}");
		Field(builder, "MajorRuntimeVersion", header.MajorRuntimeVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "MinorRuntimeVersion", header.MinorRuntimeVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "MetaData", DescribeDirectory(header.Metadata));
		Field(builder, "Flags", $"0x{(uint)header.Flags:X8} ({PeImageInfo.DescribeFlags(header.Flags)})");
		Field(builder, "EntryPointToken", $"0x{header.EntryPointToken_or_RVA:X8}");
		Field(builder, "Resources", DescribeDirectory(header.Resources));
		Field(builder, "StrongNameSignature", DescribeDirectory(header.StrongNameSignature));
		Field(builder, "CodeManagerTable", DescribeDirectory(header.CodeManagerTable));
		Field(builder, "VTableFixups", DescribeDirectory(header.VTableFixups));
		Field(builder, "ExportAddressTableJumps", DescribeDirectory(header.ExportAddressTableJumps));
		Field(builder, "ManagedNativeHeader", DescribeDirectory(header.ManagedNativeHeader));
	}

	static void AppendStorageSignature(StringBuilder builder, PeStructureSource source) {
		if (source.Metadata?.MetadataHeader is not { } header)
			return;
		AppendHeader(builder, header.StartOffset, header.StorageHeaderOffset, "Storage Signature");
		Field(builder, "Signature", $"0x{header.Signature:X8} ({DescribeSignature(header.Signature)})");
		Field(builder, "MajorVersion", header.MajorVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "MinorVersion", header.MinorVersion.ToString(CultureInfo.InvariantCulture));
		Field(builder, "Reserved", $"0x{header.Reserved1:X8}");
		Field(builder, "VersionStringLength", header.StringLength.ToString(CultureInfo.InvariantCulture));
		Field(builder, "VersionString", header.VersionString);
	}

	static void AppendStorageHeader(StringBuilder builder, PeStructureSource source) {
		if (source.Metadata?.MetadataHeader is not { } header)
			return;
		AppendHeader(builder, header.StorageHeaderOffset, header.EndOffset, "Storage Header");
		Field(builder, "Flags", $"0x{(ushort)header.Flags:X4} ({PeImageInfo.DescribeFlags(header.Flags)})");
		Field(builder, "Streams", header.Streams.ToString(CultureInfo.InvariantCulture));
		foreach (var stream in header.StreamHeaders)
			Field(builder, stream.Name, $"offset 0x{stream.Offset:X8}, size 0x{stream.StreamSize:X8}");
	}

	static void AppendStorageStream(StringBuilder builder, PeStructureSource source, int index) {
		if (GetStream(source, index) is not { } stream)
			return;
		AppendHeader(builder, stream.StartOffset, stream.EndOffset, Label(source, PeStructureKind.StorageStream, index));
		Field(builder, "Name", stream.Name);
		Field(builder, "Offset", stream.StreamHeader is { } header ? $"0x{header.Offset:X8}" : "-");
		Field(builder, "Size", $"0x{stream.StreamLength:X8}");
	}

	/// <summary>The name the file itself stores for a metadata stream, which is what dnSpy shows.</summary>
	static string GetStreamName(PeStructureSource source, int index) =>
		GetStream(source, index) is { } stream ? stream.StreamHeader?.Name ?? stream.Name : "-";

	static dnlib.DotNet.MD.DotNetStream? GetStream(PeStructureSource source, int index) =>
		source.Metadata is { } metadata && index >= 0 && index < metadata.AllStreams.Count
			? metadata.AllStreams[index]
			: null;

	static string DescribeOptionalHeader(PEImage peImage) =>
		$"Optional Header ({(peImage.ImageNTHeaders.OptionalHeader.Magic == 0x20B ? "64" : "32")}-bit)";

	static string DescribeSection(PEImage peImage, int index) =>
		$"Section #{index}: {(index >= 0 && index < peImage.ImageSectionHeaders.Count ? peImage.ImageSectionHeaders[index].DisplayName.TrimEnd() : "-")}";

	static void Field(StringBuilder builder, string name, string value) => builder.AppendLine($"{name + ":",-22}{value}");

	/// <summary>The file range a structure covers, written the way dnSpy's hex nodes introduce it.</summary>
	static void AppendHeader(StringBuilder builder, FileOffset start, FileOffset end, string label) =>
		AppendHeader(builder, Offset(start), Offset(end), label);

	static void AppendHeader(StringBuilder builder, ulong start, ulong end, string label) =>
		builder.AppendLine($"// {start:X8} - {end - 1:X8} {label}");

	static ulong Offset(FileOffset offset) => Convert.ToUInt64(offset);

	/// <summary>dnSpy writes the timestamp as a number with the date it stands for next to it.</summary>
	static string DescribeTimestamp(uint timestamp) {
		if ((int)timestamp <= 0)
			return $"0x{timestamp:X8} (Unknown)";
		var date = DateTimeOffset.FromUnixTimeSeconds(timestamp).ToLocalTime();
		return $"0x{timestamp:X8} ({date.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)})";
	}

	static string DescribeDirectory(ImageDataDirectory directory) =>
		directory.Size == 0 ? "RVA 0x00000000, size 0x00000000" : $"RVA 0x{(uint)directory.VirtualAddress:X8}, size 0x{directory.Size:X8}";

	/// <summary>The metadata root is signed with "BSJB", which is what those four bytes spell.</summary>
	static string DescribeSignature(uint signature) => signature == 0x424A5342 ? "BSJB" : "INVALID";
}
