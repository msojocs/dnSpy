using dnlib.PE;

namespace dnSpy.Backend.Core;

/// <summary>
/// An entry for a PE file that is not a managed .NET assembly. It stores the PE image
/// information and is used to display PE headers and sections in the tree view.
/// </summary>
internal sealed class PeOnlyModuleEntry : WorkspaceManager.IModuleEntry {
	public string Id { get; set; } = string.Empty;
	public string Path { get; }
	public PEImage PEImage { get; }
	public long FileLength { get; }

	/// <summary>
	/// Always false - non-managed PE files cannot be edited.
	/// </summary>
	public bool IsModified { get; set; }

	public PeOnlyModuleEntry(string path, PEImage peImage) {
		Path = path;
		PEImage = peImage;
		FileLength = new FileInfo(path).Length;
	}

	/// <summary>
	/// Gets whether this is an executable (EXE) vs a DLL.
	/// </summary>
	public bool IsExe => (PEImage.ImageNTHeaders.FileHeader.Characteristics & Characteristics.Dll) == 0;
}
