using System.Globalization;
using Machine = dnlib.PE.Machine;
using Subsystem = dnlib.PE.Subsystem;

namespace dnSpy.Backend.Core;

/// <summary>
/// The wording dnSpy's hex structure nodes use for the PE values that are not plain numbers: the machine and
/// subsystem names (dnSpy's TargetFrameworkUtils.GetArchString and its subsystem table), the name of every
/// flag that is set, and the name of a data directory. A fields dump is only readable because of these.
/// </summary>
internal static class PeImageInfo {
	public static string DescribeMachine(Machine machine) => machine switch {
		Machine.I386 => "x86",
		Machine.AMD64 => "x64",
		Machine.IA64 => "IA64",
		Machine.ARM => "ARM",
		Machine.THUMB => "ARM Thumb",
		Machine.ARMNT => "ARM Thumb-2",
		Machine.ARM64 => "ARM64",
		Machine.EBC => "EFI Bytecode",
		Machine.MIPS16 => "MIPS16",
		Machine.MIPSFPU => "MIPS FPU",
		Machine.MIPSFPU16 => "MIPS FPU16",
		Machine.SH3 => "SH3",
		Machine.SH3DSP => "SH3DSP",
		Machine.SH4 => "SH4",
		Machine.SH5 => "SH5",
		Machine.R4000 => "R4000",
		Machine.WCEMIPSV2 => "MIPS WCE v2",
		Machine.M32R => "M32R",
		Machine.R3000 => "R3000",
		Machine.R10000 => "R10000",
		_ => $"Unknown ({machine})",
	};

	public static string DescribeSubsystem(Subsystem subsystem) => subsystem switch {
		Subsystem.Native => "Native",
		Subsystem.WindowsGui => "Windows GUI",
		Subsystem.WindowsCui => "Windows Console",
		Subsystem.Os2Cui => "OS/2 Console",
		Subsystem.PosixCui => "Posix Console",
		Subsystem.NativeWindows => "Native Windows",
		Subsystem.WindowsCeGui => "Windows CE GUI",
		Subsystem.EfiApplication => "EFI Application",
		Subsystem.EfiBootServiceDriver => "EFI Boot Service Driver",
		Subsystem.EfiRuntimeDriver => "EFI Runtime Driver",
		Subsystem.EfiRom => "EFI ROM",
		Subsystem.Xbox => "Xbox",
		_ => $"Unknown ({subsystem})",
	};

	/// <summary>
	/// The names of the flags that are set. dnSpy's hex fields show each set bit next to the value, which is
	/// what makes a characteristics column mean something; a value with no name at all stays a number.
	/// </summary>
	public static string DescribeFlags<T>(T value) where T : struct, Enum {
		var flags = Convert.ToUInt64(value);
		var names = Enum.GetValues<T>()
			.Where(candidate => IsSingleBit(Convert.ToUInt64(candidate)) && (flags & Convert.ToUInt64(candidate)) == Convert.ToUInt64(candidate))
			.Select(candidate => candidate.ToString())
			.ToArray();
		return names.Length == 0 ? "0x" + flags.ToString("X8", CultureInfo.InvariantCulture) : string.Join(" | ", names);
	}

	static bool IsSingleBit(ulong value) => value != 0 && (value & (value - 1)) == 0;

	/// <summary>
	/// Section characteristics are a plain <c>uint</c> in dnlib rather than an enum, so the names dnSpy's
	/// ImageSectionHeaderVM gives them — including the four-bit alignment field in the middle — are repeated
	/// here.
	/// </summary>
	public static string DescribeSectionCharacteristics(uint characteristics) {
		var names = new List<string>();
		foreach (var (bit, name) in sectionCharacteristics) {
			if ((characteristics & (1u << bit)) != 0)
				names.Add(name);
		}
		var alignment = (characteristics >> 20) & 0xF;
		if (alignment != 0)
			names.Add($"Alignment: {alignmentNames[alignment]}");
		return names.Count == 0 ? $"0x{characteristics:X8}" : string.Join(" | ", names);
	}

	static readonly (int Bit, string Name)[] sectionCharacteristics = [
		(0, "TYPE_DSECT"), (1, "TYPE_NOLOAD"), (2, "TYPE_GROUP"), (3, "TYPE_NO_PAD"), (4, "TYPE_COPY"),
		(5, "CNT_CODE"), (6, "CNT_INITIALIZED_DATA"), (7, "CNT_UNINITIALIZED_DATA"), (8, "LNK_OTHER"),
		(9, "LNK_INFO"), (10, "TYPE_OVER"), (11, "LNK_REMOVE"), (12, "LNK_COMDAT"), (13, "RESERVED"),
		(14, "NO_DEFER_SPEC_EXC"), (15, "GPREL"), (16, "MEM_SYSHEAP"), (17, "MEM_PURGEABLE"), (18, "MEM_LOCKED"),
		(19, "MEM_PRELOAD"), (24, "LNK_NRELOC_OVFL"), (25, "MEM_DISCARDABLE"), (26, "MEM_NOT_CACHED"),
		(27, "MEM_NOT_PAGED"), (28, "MEM_SHARED"), (29, "MEM_EXECUTE"), (30, "MEM_READ"), (31, "MEM_WRITE"),
	];

	static readonly string[] alignmentNames = [
		"Default", "1 Byte", "2 Bytes", "4 Bytes", "8 Bytes", "16 Bytes", "32 Bytes", "64 Bytes", "128 Bytes",
		"256 Bytes", "512 Bytes", "1024 Bytes", "2048 Bytes", "4096 Bytes", "8192 Bytes", "Reserved",
	];

	/// <summary>The name of a data directory, the way dnSpy's optional header node names it.</summary>
	public static string DescribeDataDirectory(int index) => index switch {
		0 => "Export",
		1 => "Import",
		2 => "Resource",
		3 => "Exception",
		4 => "Security",
		5 => "Base Reloc",
		6 => "Debug",
		7 => "Architecture",
		8 => "Global Ptr",
		9 => "TLS",
		10 => "Load Config",
		11 => "Bound Import",
		12 => "IAT",
		13 => "Delay Import",
		14 => ".NET",
		15 => "Reserved15",
		_ => $"Directory{index}",
	};
}
