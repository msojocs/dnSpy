namespace dnSpy.Backend.Core;

/// <summary>
/// The names of the values in the ELF headers, the way <c>readelf</c> and the elf.h constants spell them.
/// A value that has no name here is shown as the number it is, since a name this list does not know is
/// still a value worth reading.
/// </summary>
internal static class ElfNames {
	public static string DescribeClass(bool is64Bit) => is64Bit ? "64-bit (ELFCLASS64)" : "32-bit (ELFCLASS32)";

	public static string DescribeData(bool littleEndian) => littleEndian ? "Little endian (ELFDATA2LSB)" : "Big endian (ELFDATA2MSB)";

	public static string DescribeOsAbi(byte osabi) => osabi switch {
		0 => "System V (ELFOSABI_SYSV)",
		1 => "HP-UX (ELFOSABI_HPUX)",
		2 => "NetBSD (ELFOSABI_NETBSD)",
		3 => "Linux (ELFOSABI_LINUX)",
		6 => "Solaris (ELFOSABI_SOLARIS)",
		7 => "AIX (ELFOSABI_AIX)",
		8 => "IRIX (ELFOSABI_IRIX)",
		9 => "FreeBSD (ELFOSABI_FREEBSD)",
		10 => "Tru64 (ELFOSABI_TRU64)",
		12 => "OpenBSD (ELFOSABI_OPENBSD)",
		97 => "ARM (ELFOSABI_ARM_AEABI)",
		255 => "Standalone (ELFOSABI_STANDALONE)",
		_ => $"0x{osabi:X2}",
	};

	public static string DescribeType(ushort type) => type switch {
		0 => "None (ET_NONE)",
		1 => "Relocatable file (ET_REL)",
		2 => "Executable file (ET_EXEC)",
		3 => "Shared object file (ET_DYN)",
		4 => "Core file (ET_CORE)",
		0xFE00 => "Operating system specific (ET_LOOS)",
		0xFEFF => "Operating system specific (ET_HIOS)",
		0xFF00 => "Processor specific (ET_LOPROC)",
		0xFFFF => "Processor specific (ET_HIPROC)",
		_ => $"0x{type:X4}",
	};

	public static string DescribeMachine(ushort machine) => machine switch {
		0 => "No machine (EM_NONE)",
		2 => "SPARC (EM_SPARC)",
		3 => "Intel 80386 (EM_386)",
		8 => "MIPS (EM_MIPS)",
		20 => "PowerPC (EM_PPC)",
		21 => "PowerPC 64-bit (EM_PPC64)",
		22 => "IBM S/390 (EM_S390)",
		40 => "ARM (EM_ARM)",
		42 => "SuperH (EM_SH)",
		50 => "IA-64 (EM_IA_64)",
		62 => "x86-64 (EM_X86_64)",
		76 => "Axis CRIS (EM_CRIS)",
		83 => "Atmel AVR (EM_AVR)",
		88 => "Renesas M32R (EM_M32R)",
		92 => "OpenRISC (EM_OPENRISC)",
		113 => "Altera Nios II (EM_ALTERA_NIOS2)",
		183 => "ARM 64-bit (EM_AARCH64)",
		189 => "Xilinx MicroBlaze (EM_MICROBLAZE)",
		243 => "RISC-V (EM_RISCV)",
		247 => "Linux BPF (EM_BPF)",
		258 => "LoongArch (EM_LOONGARCH)",
		_ => $"0x{machine:X4}",
	};

	public static string DescribeProgramHeaderType(uint type) => type switch {
		0 => "Unused (PT_NULL)",
		1 => "Loadable segment (PT_LOAD)",
		2 => "Dynamic linking information (PT_DYNAMIC)",
		3 => "Interpreter (PT_INTERP)",
		4 => "Auxiliary information (PT_NOTE)",
		5 => "Reserved (PT_SHLIB)",
		6 => "Program header table (PT_PHDR)",
		7 => "Thread-local storage (PT_TLS)",
		0x6474E550 => "GCC exception handling frames (PT_GNU_EH_FRAME)",
		0x6474E551 => "Stack permissions (PT_GNU_STACK)",
		0x6474E552 => "Relro (PT_GNU_RELRO)",
		0x6474E553 => "Property notes (PT_GNU_PROPERTY)",
		0x70000000 => "Processor specific (PT_LOPROC)",
		0x7FFFFFFF => "Processor specific (PT_HIPROC)",
		_ => $"0x{type:X8}",
	};

	public static string DescribeSectionType(uint type) => type switch {
		0 => "Unused (SHT_NULL)",
		1 => "Program data (SHT_PROGBITS)",
		2 => "Symbol table (SHT_SYMTAB)",
		3 => "String table (SHT_STRTAB)",
		4 => "Relocations with addends (SHT_RELA)",
		5 => "Symbol hash table (SHT_HASH)",
		6 => "Dynamic linking information (SHT_DYNAMIC)",
		7 => "Notes (SHT_NOTE)",
		8 => "Program space with no data (SHT_NOBITS)",
		9 => "Relocations without addends (SHT_REL)",
		10 => "Reserved (SHT_SHLIB)",
		11 => "Dynamic linker symbol table (SHT_DYNSYM)",
		14 => "Array of constructors (SHT_INIT_ARRAY)",
		15 => "Array of destructors (SHT_FINI_ARRAY)",
		16 => "Array of pre-constructors (SHT_PREINIT_ARRAY)",
		17 => "Section group (SHT_GROUP)",
		18 => "Extended symbol table indices (SHT_SYMTAB_SHNDX)",
		0x6FFFFFF5 => "GNU attributes (SHT_GNU_ATTRIBUTES)",
		0x6FFFFFF6 => "GNU hash table (SHT_GNU_HASH)",
		0x6FFFFFF7 => "GNU version definitions (SHT_GNU_verdef)",
		0x6FFFFFF8 => "GNU version needs (SHT_GNU_verneed)",
		0x6FFFFFFD => "GNU version symbol table (SHT_GNU_versym)",
		_ => $"0x{type:X8}",
	};

	/// <summary>The three permission bits a program header carries, which readelf prints as "R", "W" and "E".</summary>
	public static string DescribeProgramHeaderFlags(uint flags) {
		var text = string.Concat(
			(flags & 4) != 0 ? "R" : string.Empty,
			(flags & 2) != 0 ? "W" : string.Empty,
			(flags & 1) != 0 ? "X" : string.Empty);
		var unknown = flags & ~7u;
		if (unknown != 0)
			text = text.Length == 0 ? $"0x{unknown:X8}" : $"{text} | 0x{unknown:X8}";
		return text.Length == 0 ? "None" : text;
	}

	public static string DescribeSectionFlags(ulong flags) {
		if (flags == 0)
			return "None";
		var names = new List<string>();
		foreach (var (bit, name) in SectionFlags)
			if ((flags & bit) != 0)
				names.Add(name);
		var known = SectionFlags.Aggregate(0UL, (mask, entry) => mask | entry.Bit);
		var unknown = flags & ~known;
		if (unknown != 0)
			names.Add($"0x{unknown:X16}");
		return string.Join(" | ", names);
	}

	static readonly (ulong Bit, string Name)[] SectionFlags = [
		(0x1, "Writable (SHF_WRITE)"),
		(0x2, "Occupies memory (SHF_ALLOC)"),
		(0x4, "Executable (SHF_EXECINSTR)"),
		(0x10, "Mergeable (SHF_MERGE)"),
		(0x20, "Strings (SHF_STRINGS)"),
		(0x40, "Section info (SHF_INFO_LINK)"),
		(0x80, "Preserve link order (SHF_LINK_ORDER)"),
		(0x100, "Operating system specific (SHF_OS_NONCONFORMING)"),
		(0x200, "Member of a group (SHF_GROUP)"),
		(0x400, "Thread-local storage (SHF_TLS)"),
		(0x800, "Compressed (SHF_COMPRESSED)"),
		(0x0FF00000, "Operating system specific (SHF_MASKOS)"),
		(0xF0000000, "Processor specific (SHF_MASKPROC)"),
	];
}
