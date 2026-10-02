using System.Runtime.InteropServices;
using ICorDebugSharp;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// Loads <c>libdbgshim.so</c> once per process. <see cref="DbgShim"/> declares its entry points
/// against the bare name <c>dbgshim</c>, which the runtime normally resolves through the default
/// loader search path; that path does not include the host's own directory, so the library is
/// pre-loaded from an absolute path before the first <see cref="DbgShim"/> call.
/// </summary>
internal static class DbgShimLoader {
	static readonly object Gate = new();
	static string? loadedPath;

	/// <summary>Resolves and loads <c>libdbgshim.so</c>. Safe to call more than once.</summary>
	/// <exception cref="FileNotFoundException">The library could not be located.</exception>
	public static void EnsureLoaded(string? explicitPath = null) {
		lock (Gate) {
			if (loadedPath is not null)
				return;
			var path = DbgShimLocator.Find(explicitPath);
			// glibc reuses an already loaded object when a later dlopen asks for the same soname,
			// so pre-loading by absolute path is what makes the generated P/Invokes resolve.
			NativeLibrary.Load(path);
			TryRegisterResolver(path);
			loadedPath = path;
		}
	}

	/// <summary>The resolved library path, or <c>null</c> when nothing has been loaded yet.</summary>
	public static string? LoadedPath => loadedPath;

	static void TryRegisterResolver(string path) {
		try {
			NativeLibrary.SetDllImportResolver(typeof(DbgShim).Assembly, (name, _, _) =>
				name is "dbgshim" or DbgShimLocator.NativeFileName ? NativeLibrary.Load(path) : IntPtr.Zero);
		}
		catch (InvalidOperationException) {
			// A resolver can only be registered once per assembly, and another component may
			// already have done it. The pre-load above is the primary mechanism anyway.
		}
	}
}
