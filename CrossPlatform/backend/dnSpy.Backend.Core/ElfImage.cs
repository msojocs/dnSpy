using System.Buffers.Binary;

namespace dnSpy.Backend.Core;

/// <summary>
/// An ELF file, read the way <c>readelf -h -l -S</c> reads one: the file header, the program headers and the
/// section headers, with the section names resolved through the section header string table. Only those
/// headers are parsed, so what a section or a segment holds is left in the file and never held in memory.
/// </summary>
internal sealed class ElfImage {
	/// <summary>What e_shstrndx holds when the real index of the section name table is in section 0.</summary>
	const int ShnXIndex = 0xFFFF;
	/// <summary>What e_phnum holds when the real program header count is in section 0.</summary>
	const int PnXNum = 0xFFFF;
	/// <summary>How much of the name table is read at most — a damaged header can otherwise ask for gigabytes.</summary>
	const int MaxNameTableSize = 1024 * 1024;

	ElfImage(ElfFileHeader header, IReadOnlyList<ElfProgramHeader> programHeaders, IReadOnlyList<ElfSectionHeader> sections, long fileLength) {
		Header = header;
		ProgramHeaders = programHeaders;
		Sections = sections;
		FileLength = fileLength;
	}

	public ElfFileHeader Header { get; }

	public IReadOnlyList<ElfProgramHeader> ProgramHeaders { get; }

	public IReadOnlyList<ElfSectionHeader> Sections { get; }

	public long FileLength { get; }

	/// <summary>
	/// Whether the file starts with the four magic bytes. This is the cheap test the loader runs before it
	/// reads anything else, and it says nothing about the rest of the header.
	/// </summary>
	public static bool HasMagic(string path) {
		try {
			using var stream = File.OpenRead(path);
			var magic = new byte[4];
			return ReadAt(stream, 0, magic) && IsMagic(magic);
		}
		catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException) {
			return false;
		}
	}

	/// <summary>
	/// Reads the headers of an ELF file, or nothing when the file is not one or its own header is too short
	/// to read. A table that runs past the end of the file is cut short rather than refused, so a file whose
	/// header did survive still shows the headers that are really there.
	/// </summary>
	public static ElfImage? TryLoad(string path) {
		try {
			using var stream = File.OpenRead(path);
			return Load(stream);
		}
		catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException) {
			return null;
		}
	}

	static ElfImage? Load(Stream stream) {
		var fileLength = stream.Length;
		var ident = new byte[16];
		if (fileLength < ident.Length || !ReadAt(stream, 0, ident) || !IsMagic(ident))
			return null;
		// e_ident[4] is the class, e_ident[5] the byte order; both are fixed by the file and by nothing else.
		var is64Bit = ident[4] switch { 1 => (bool?)false, 2 => (bool?)true, _ => null };
		var littleEndian = ident[5] switch { 1 => (bool?)true, 2 => (bool?)false, _ => null };
		if (is64Bit is null || littleEndian is null)
			return null;
		var headerSize = is64Bit.Value ? 64 : 52;
		var headerBytes = new byte[headerSize];
		if (fileLength < headerSize || !ReadAt(stream, 0, headerBytes))
			return null;

		var header = ParseFileHeader(headerBytes, is64Bit.Value, littleEndian.Value);
		var sections = ReadSections(stream, fileLength, header);
		var programHeaders = ReadProgramHeaders(stream, fileLength, header, sections);
		return new ElfImage(header, programHeaders, sections, fileLength);
	}

	static bool IsMagic(ReadOnlySpan<byte> bytes) =>
		bytes.Length >= 4 && bytes[0] == 0x7F && bytes[1] == (byte)'E' && bytes[2] == (byte)'L' && bytes[3] == (byte)'F';

	/// <summary>
	/// The file header. The 32-bit and 64-bit layouts share the first 16 fields but not their offsets or
	/// widths, so the two are read apart; everything after them is the same in both.
	/// </summary>
	static ElfFileHeader ParseFileHeader(byte[] bytes, bool is64Bit, bool littleEndian) {
		var reader = new ElfReader(bytes, littleEndian);
		var fields = is64Bit
			? (EntryPoint: reader.U64(0x18), ProgramHeaderOffset: reader.U64(0x20), SectionHeaderOffset: reader.U64(0x28), Flags: reader.U32(0x30),
				HeaderSize: reader.U16(0x34), ProgramHeaderEntrySize: reader.U16(0x36), ProgramHeaderCount: reader.U16(0x38),
				SectionHeaderEntrySize: reader.U16(0x3A), SectionHeaderCount: reader.U16(0x3C), SectionNameTableIndex: reader.U16(0x3E))
			: (EntryPoint: (ulong)reader.U32(0x18), ProgramHeaderOffset: (ulong)reader.U32(0x1C), SectionHeaderOffset: (ulong)reader.U32(0x20), Flags: reader.U32(0x24),
				HeaderSize: reader.U16(0x28), ProgramHeaderEntrySize: reader.U16(0x2A), ProgramHeaderCount: reader.U16(0x2C),
				SectionHeaderEntrySize: reader.U16(0x2E), SectionHeaderCount: reader.U16(0x30), SectionNameTableIndex: reader.U16(0x32));
		return new ElfFileHeader(
			is64Bit,
			littleEndian,
			bytes[7],
			bytes[8],
			reader.U16(0x10),
			reader.U16(0x12),
			reader.U32(0x14),
			fields.EntryPoint,
			fields.ProgramHeaderOffset,
			fields.SectionHeaderOffset,
			fields.Flags,
			fields.HeaderSize,
			fields.ProgramHeaderEntrySize,
			fields.ProgramHeaderCount,
			fields.SectionHeaderEntrySize,
			fields.SectionHeaderCount,
			fields.SectionNameTableIndex);
	}

	/// <summary>
	/// The section headers, with their names filled in from the string table they point into. A count the
	/// header cannot hold lives in section 0 (e_shnum == 0), and so does the index of the name table
	/// (e_shstrndx == SHN_XINDEX), which is why section 0 is read first when either says so.
	/// </summary>
	static IReadOnlyList<ElfSectionHeader> ReadSections(Stream stream, long fileLength, ElfFileHeader header) {
		var entrySize = header.SectionHeaderEntrySize;
		var expectedSize = header.Is64Bit ? 64 : 40;
		if (header.SectionHeaderOffset == 0 || entrySize < expectedSize)
			return Array.Empty<ElfSectionHeader>();

		var count = header.SectionHeaderCount;
		if (count == 0) {
			var first = ReadSectionHeader(stream, header, header.SectionHeaderOffset);
			if (first is not { } section0)
				return Array.Empty<ElfSectionHeader>();
			count = ClampCount(section0.Size);
		}

		var sections = new List<ElfSectionHeader>();
		foreach (var offset in TableOffsets(header.SectionHeaderOffset, entrySize, count, fileLength)) {
			if (ReadSectionHeader(stream, header, offset) is { } section)
				sections.Add(section);
		}
		if (sections.Count == 0)
			return sections;

		var nameTableIndex = header.SectionNameTableIndex;
		if (nameTableIndex == ShnXIndex)
			nameTableIndex = ClampCount(sections[0].Link);
		var names = ReadNameTable(stream, sections, nameTableIndex);
		for (var i = 0; i < sections.Count; i++)
			sections[i] = sections[i] with { Name = ResolveName(names, sections[i].NameOffset) };
		return sections;
	}

	/// <summary>
	/// The program headers. Like the section count, the real one can live in section 0 when the header's own
	/// field is full, so the sections are consulted for it.
	/// </summary>
	static IReadOnlyList<ElfProgramHeader> ReadProgramHeaders(Stream stream, long fileLength, ElfFileHeader header, IReadOnlyList<ElfSectionHeader> sections) {
		var entrySize = header.ProgramHeaderEntrySize;
		var expectedSize = header.Is64Bit ? 56 : 32;
		if (header.ProgramHeaderOffset == 0 || entrySize < expectedSize)
			return Array.Empty<ElfProgramHeader>();

		var count = header.ProgramHeaderCount;
		if (count == PnXNum && sections.Count > 0)
			count = ClampCount(sections[0].Info);

		var programHeaders = new List<ElfProgramHeader>();
		foreach (var offset in TableOffsets(header.ProgramHeaderOffset, entrySize, count, fileLength)) {
			var bytes = new byte[entrySize];
			if (!ReadAt(stream, (long)offset, bytes))
				break;
			programHeaders.Add(ParseProgramHeader(bytes, header));
		}
		return programHeaders;
	}

	/// <summary>
	/// The file offsets of a table's entries, stopping at the end of the file: a header that claims more
	/// entries than are there is a damaged file, and the entries it does hold are still worth showing.
	/// </summary>
	static IEnumerable<ulong> TableOffsets(ulong start, ushort entrySize, int count, long fileLength) {
		var available = ((long)start < fileLength ? fileLength - (long)start : 0) / entrySize;
		var entries = Math.Min(count, available);
		for (var i = 0L; i < entries; i++)
			yield return start + (ulong)(i * entrySize);
	}

	static ElfProgramHeader ParseProgramHeader(byte[] bytes, ElfFileHeader header) {
		var reader = new ElfReader(bytes, header.IsLittleEndian);
		// p_flags sits between the type and the offset in a 64-bit header and at the end in a 32-bit one.
		return header.Is64Bit
			? new ElfProgramHeader(reader.U32(0), reader.U32(4), reader.U64(8), reader.U64(16), reader.U64(24), reader.U64(32), reader.U64(40), reader.U64(48))
			: new ElfProgramHeader(reader.U32(0), reader.U32(24), reader.U32(4), reader.U32(8), reader.U32(12), reader.U32(16), reader.U32(20), reader.U32(28));
	}

	static ElfSectionHeader? ReadSectionHeader(Stream stream, ElfFileHeader header, ulong offset) {
		var bytes = new byte[header.SectionHeaderEntrySize];
		if (!ReadAt(stream, (long)offset, bytes))
			return null;
		var reader = new ElfReader(bytes, header.IsLittleEndian);
		return header.Is64Bit
			? new ElfSectionHeader(string.Empty, reader.U32(0), reader.U32(4), reader.U64(8), reader.U64(16), reader.U64(24), reader.U64(32), reader.U32(40), reader.U32(44), reader.U64(48), reader.U64(56))
			: new ElfSectionHeader(string.Empty, reader.U32(0), reader.U32(4), reader.U32(8), reader.U32(12), reader.U32(16), reader.U32(20), reader.U32(24), reader.U32(28), reader.U32(32), reader.U32(36));
	}

	/// <summary>The bytes of the section header string table, or nothing when the index does not name one.</summary>
	static byte[] ReadNameTable(Stream stream, IReadOnlyList<ElfSectionHeader> sections, int index) {
		if (index < 0 || index >= sections.Count)
			return Array.Empty<byte>();
		var section = sections[index];
		var size = (int)Math.Min(section.Size, MaxNameTableSize);
		if (size <= 0)
			return Array.Empty<byte>();
		var names = new byte[size];
		return ReadAt(stream, (long)section.Offset, names) ? names : Array.Empty<byte>();
	}

	static string ResolveName(byte[] names, uint offset) {
		if (offset >= names.Length)
			return string.Empty;
		var end = Array.IndexOf(names, (byte)0, (int)offset);
		if (end < 0)
			end = names.Length;
		return System.Text.Encoding.UTF8.GetString(names, (int)offset, end - (int)offset);
	}

	/// <summary>A count that came out of a 64-bit field, kept inside what an index can hold.</summary>
	static int ClampCount(ulong value) => (int)Math.Min(value, int.MaxValue);

	/// <summary>Reads exactly <paramref name="buffer"/>.Length bytes at a file offset, or reports that it cannot.</summary>
	static bool ReadAt(Stream stream, long offset, byte[] buffer) {
		if (offset < 0 || offset + buffer.Length > stream.Length)
			return false;
		stream.Position = offset;
		var read = 0;
		while (read < buffer.Length) {
			var count = stream.Read(buffer, read, buffer.Length - read);
			if (count <= 0)
				return false;
			read += count;
		}
		return true;
	}

	/// <summary>Reads little- or big-endian numbers out of a buffer, since the file decides which it is.</summary>
	readonly struct ElfReader(byte[] data, bool littleEndian) {
		public ushort U16(int offset) => littleEndian
			? BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(offset))
			: BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(offset));

		public uint U32(int offset) => littleEndian
			? BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(offset))
			: BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(offset));

		public ulong U64(int offset) => littleEndian
			? BinaryPrimitives.ReadUInt64LittleEndian(data.AsSpan(offset))
			: BinaryPrimitives.ReadUInt64BigEndian(data.AsSpan(offset));
	}
}

/// <summary>
/// The ELF file header (Elf32_Ehdr / Elf64_Ehdr). The counts are the ones the file really has: when the
/// header's own field is full, the value section 0 holds has already been put here in its place.
/// </summary>
internal sealed record ElfFileHeader(
	bool Is64Bit,
	bool IsLittleEndian,
	byte OsAbi,
	byte AbiVersion,
	ushort Type,
	ushort Machine,
	uint Version,
	ulong EntryPoint,
	ulong ProgramHeaderOffset,
	ulong SectionHeaderOffset,
	uint Flags,
	ushort HeaderSize,
	ushort ProgramHeaderEntrySize,
	int ProgramHeaderCount,
	ushort SectionHeaderEntrySize,
	int SectionHeaderCount,
	int SectionNameTableIndex);

/// <summary>One program header (Elf32_Phdr / Elf64_Phdr), the description of a segment of the file.</summary>
internal sealed record ElfProgramHeader(
	uint Type,
	uint Flags,
	ulong Offset,
	ulong VirtualAddress,
	ulong PhysicalAddress,
	ulong FileSize,
	ulong MemorySize,
	ulong Alignment);

/// <summary>
/// One section header (Elf32_Shdr / Elf64_Shdr). <see cref="NameOffset"/> is what the file stores;
/// <see cref="Name"/> is what that offset resolved to in the section header string table.
/// </summary>
internal sealed record ElfSectionHeader(
	string Name,
	uint NameOffset,
	uint Type,
	ulong Flags,
	ulong Address,
	ulong Offset,
	ulong Size,
	uint Link,
	uint Info,
	ulong Alignment,
	ulong EntrySize);
