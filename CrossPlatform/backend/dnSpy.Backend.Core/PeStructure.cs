using dnlib.DotNet.MD;
using dnlib.PE;

namespace dnSpy.Backend.Core;

/// <summary>
/// Which part of a PE image a structure node stands for. These are the hex structure nodes dnSpy's AsmEditor
/// hangs off a PE node (dnSpy.AsmEditor.Hex.Nodes.PENode.CreateChildren), in the order it creates them.
/// </summary>
internal enum PeStructureKind {
	DosHeader,
	FileHeader,
	OptionalHeader,
	Section,
	Cor20Header,
	StorageSignature,
	StorageHeader,
	StorageStream,
}

/// <summary>
/// The value of one PE structure node: which structure it is, plus the section or metadata stream it stands
/// for when the structure is one of a list. The fields themselves are read off the image by
/// <see cref="PeStructureFormatter"/>, so an image that was reloaded never leaves a stale copy in the tree.
/// </summary>
internal sealed record PeStructureValue(PeStructureKind Kind, int Index);

/// <summary>
/// What the structures of a file are read from: its image, and the .NET metadata when the file is a managed
/// module. Both come from the file the tree node belongs to, and a file dnlib could not read has neither.
/// </summary>
internal sealed record PeStructureSource(PEImage Image, Metadata? Metadata);
