using System.Reflection.PortableExecutable;
using ICorDebugSharp;
using ICorDebugSharp.Extensions;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// The "break at the entry point" half of a launch. The client always asks for it, so a launch that
/// ignored the flag would run the debuggee to completion before the user could set anything.
/// </summary>
/// <remarks>
/// The entry point comes from the PE's CLI header rather than from a metadata walk: the runtime's own
/// answer, <c>CorHeader.EntryPointTokenOrRelativeVirtualAddress</c>, is exactly the token
/// <c>GetFunctionFromToken</c> wants, and reading it costs one file open. A native entry point is a
/// relative virtual address instead of a token, so such a module is skipped rather than guessed at.
/// </remarks>
internal sealed partial class CorDebugSession {
	ICorDebugFunctionBreakpoint? entryBreakpoint;

	/// <summary>Arms the entry-point breakpoint once the module we launched loads.</summary>
	void ArmEntryBreakpoint(ICorDebugModule module) {
		if (!StopAtEntry || entryBreakpoint is not null || HasExited)
			return;
		var modulePath = BreakpointTable.TryGetModulePath(module);
		if (string.IsNullOrEmpty(modulePath) || LaunchProgram is null || !BreakpointTable.PathsMatch(modulePath, LaunchProgram))
			return;
		if (TryReadEntryPointToken(modulePath) is not { } token)
			return;
		try {
			entryBreakpoint = module.GetFunctionFromToken(token).ILCode.CreateBreakpoint(0);
			entryBreakpoint.Activate(true);
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			// Nothing to stop at: the entry point has no IL body the engine can hook.
			entryBreakpoint = null;
		}
	}

	/// <summary>True when a hit belongs to the entry-point breakpoint, which no client request owns.</summary>
	bool IsEntryBreakpoint(ICorDebugBreakpoint breakpoint) {
		var entry = entryBreakpoint;
		if (entry is null || breakpoint is not ICorDebugFunctionBreakpoint hit)
			return false;
		try {
			return hit.Function.Token == entry.Function.Token && hit.Offset == entry.Offset;
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			return false;
		}
	}

	/// <summary>The entry point is a one-shot: once taken, it must not be reported as a client breakpoint.</summary>
	void DisarmEntryBreakpoint() {
		var entry = entryBreakpoint;
		entryBreakpoint = null;
		if (entry is null)
			return;
		try {
			entry.Activate(false);
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			// The process is gone; there is nothing left to deactivate.
		}
	}

	static int? TryReadEntryPointToken(string path) {
		try {
			using var stream = File.OpenRead(path);
			using var pe = new PEReader(stream);
			if (pe.PEHeaders.CorHeader is not { } corHeader || (corHeader.Flags & CorFlags.NativeEntryPoint) != 0)
				return null;
			var token = unchecked((int)corHeader.EntryPointTokenOrRelativeVirtualAddress);
			return token == 0 ? null : token;
		}
		catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or BadImageFormatException) {
			return null;
		}
	}
}
