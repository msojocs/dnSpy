using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;
using ICorDebugSharp;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// Bridges the native runtime-startup callback DbgShim invokes on a runtime thread back to the
/// managed launch sequence. The callback must not touch the debuggee (the runtime is blocked while
/// it runs), so it only converts the interface pointer and completes a task.
/// </summary>
internal static class RuntimeStartup {
	public sealed class State {
		public TaskCompletionSource<(ICorDebug? CorDebug, int HResult)> Completion { get; } =
			new(TaskCreationOptions.RunContinuationsAsynchronously);
		// RegisterForRuntimeStartup keeps the runtime suspended only until the startup callback
		// returns. Keep that callback blocked while the launch thread installs the managed callback
		// and calls DebugActiveProcess, otherwise a fast target can run to completion before the
		// debugger has a chance to arm its entry breakpoint.
		public TaskCompletionSource<bool> Ready { get; } =
			new(TaskCreationOptions.RunContinuationsAsynchronously);

		public GCHandle Handle { get; set; }

		/// <summary>Frees the GC handle that keeps this state alive for the native callback.</summary>
		public void Release() {
			Ready.TrySetResult(true);
			if (Handle.IsAllocated)
				Handle.Free();
		}
	}

	/// <summary>
	/// Registers for the startup notification of <paramref name="processId"/> and returns the token
	/// needed to unregister. Must be called before the runtime is resumed.
	/// </summary>
	public static unsafe IntPtr Register(uint processId, State state) {
		state.Handle = GCHandle.Alloc(state);
		var hr = DbgShim.RegisterForRuntimeStartup(processId, &OnRuntimeStartup, GCHandle.ToIntPtr(state.Handle), out var unregisterToken);
		if (hr < 0) {
			state.Handle.Free();
			state.Handle = default;
			throw new COMException("RegisterForRuntimeStartup failed.", hr);
		}
		return unregisterToken;
	}

	[UnmanagedCallersOnly(CallConvs = [typeof(CallConvCdecl)])]
	static unsafe void OnRuntimeStartup(void* corDebugPointer, void* parameter, int hResult) {
		if (GCHandle.FromIntPtr((IntPtr)parameter).Target is not State state)
			return;
		ICorDebug? corDebug = null;
		if (hResult >= 0 && corDebugPointer is not null) {
			try {
				corDebug = ComInterfaceMarshaller<ICorDebug>.ConvertToManaged(corDebugPointer);
			}
			catch (Exception) {
				corDebug = null;
			}
		}
		state.Completion.TrySetResult((corDebug, hResult));
		// The launch path performs the COM setup before allowing the runtime to continue.
		// Never wait when startup failed: the caller may be unwinding without an attach to release us.
		if (hResult >= 0)
			state.Ready.Task.GetAwaiter().GetResult();
	}
}
