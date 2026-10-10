using System.Runtime.InteropServices;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// Finds the DbgShim native library (<c>libdbgshim.so</c>, <c>dbgshim.dll</c> or
/// <c>libdbgshim.dylib</c>), the bootstrap library that hands out <c>ICorDebug</c>.
/// The .NET runtime ships mscordbi but not dbgshim, so we depend on the
/// <c>Microsoft.Diagnostics.DbgShim.&lt;rid&gt;</c> package to provide it: a RID-specific publish
/// copies it next to the host binary, while a plain build leaves it under <c>runtimes/</c>.
/// </summary>
internal static class DbgShimLocator {
	/// <summary>
	/// The shim's file name on the current platform. Windows and macOS agree with the platform
	/// convention (<c>baseName.dll</c> / <c>lib</c> + <c>baseName.dylib</c>) that the DbgShim
	/// packages themselves are laid out with.
	/// </summary>
	public static string NativeFileName => OperatingSystem.IsWindows()
		? "dbgshim.dll"
		: OperatingSystem.IsMacOS()
			? "libdbgshim.dylib"
			: "libdbgshim.so";

	public static string Find(string? explicitPath) {
		var nativeFileName = NativeFileName;
		var candidates = new List<string?> {
			explicitPath,
			Environment.GetEnvironmentVariable("DNSPY_DBGSHIM_PATH"),
			// Packaged: a RID-specific dotnet publish puts the native asset next to the host.
			Path.Combine(AppContext.BaseDirectory, nativeFileName),
			// Plain build/test: the native asset stays under the RID folder.
			Path.Combine(AppContext.BaseDirectory, "runtimes", RuntimeInformation.RuntimeIdentifier, "native", nativeFileName),
		};
		var directory = new DirectoryInfo(AppContext.BaseDirectory);
		while (directory is not null) {
			candidates.Add(Path.Combine(directory.FullName, ".tools", "dbgshim", nativeFileName));
			directory = directory.Parent;
		}
		var found = candidates.FirstOrDefault(candidate => !string.IsNullOrWhiteSpace(candidate) && File.Exists(candidate));
		return found is not null
			? Path.GetFullPath(found)
			: throw new FileNotFoundException($"{nativeFileName} was not found. Set DNSPY_DBGSHIM_PATH or restore the {nativeFileName} NuGet asset.");
	}
}
