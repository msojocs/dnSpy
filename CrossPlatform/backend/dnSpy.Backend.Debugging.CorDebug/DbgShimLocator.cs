namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// Finds <c>libdbgshim.so</c>, the bootstrap library that hands out <c>ICorDebug</c>.
/// The .NET runtime ships <c>libmscordbi.so</c> but not dbgshim, so we depend on the
/// <c>Microsoft.Diagnostics.DbgShim.linux-x64</c> package to provide it: a RID-specific publish
/// copies it next to the host binary, while a plain build leaves it under <c>runtimes/</c>.
/// </summary>
internal static class DbgShimLocator {
	public const string NativeFileName = "libdbgshim.so";

	public static string Find(string? explicitPath) {
		var candidates = new List<string?> {
			explicitPath,
			Environment.GetEnvironmentVariable("DNSPY_DBGSHIM_PATH"),
			// Packaged: dotnet publish -r linux-x64 puts the native asset next to the host.
			Path.Combine(AppContext.BaseDirectory, NativeFileName),
			// Plain build/test: the native asset stays under the RID folder.
			Path.Combine(AppContext.BaseDirectory, "runtimes", "linux-x64", "native", NativeFileName),
		};
		var directory = new DirectoryInfo(AppContext.BaseDirectory);
		while (directory is not null) {
			candidates.Add(Path.Combine(directory.FullName, ".tools", "dbgshim", NativeFileName));
			directory = directory.Parent;
		}
		var found = candidates.FirstOrDefault(candidate => !string.IsNullOrWhiteSpace(candidate) && File.Exists(candidate));
		return found is not null
			? Path.GetFullPath(found)
			: throw new FileNotFoundException($"libdbgshim.so was not found. Set DNSPY_DBGSHIM_PATH or restore the {NativeFileName} NuGet asset.");
	}
}
