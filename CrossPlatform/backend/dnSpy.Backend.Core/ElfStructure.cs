namespace dnSpy.Backend.Core;

/// <summary>
/// Which part of an ELF image a structure node stands for. These are the three tables <c>readelf</c> reads
/// with -h, -l and -S, and they are what an ELF file has to show once it is not a PE image.
/// </summary>
internal enum ElfStructureKind {
	FileHeader,
	ProgramHeader,
	SectionHeader,
}

/// <summary>
/// The value of one ELF structure node: which structure it is, plus the segment or section it stands for
/// when the structure is one of a table. The fields are read off the image by
/// <see cref="ElfStructureFormatter"/>, so a file that was reloaded never leaves a stale copy in the tree.
/// </summary>
internal sealed record ElfStructureValue(ElfStructureKind Kind, int Index);
