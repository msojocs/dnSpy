using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;
using dnSpy.Backend.Contracts;
using ICorDebugSharp;
using ICorDebugSharp.Extensions;
using Microsoft.Diagnostics.NETCore.Client;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>A debug event the session wants the client to see.</summary>
internal sealed record SessionEvent(string Event, object? Body);

/// <summary>
/// One debuggee. Owns the ICorDebug process, the tables built from its callbacks, and the
/// command surface the client drives.
/// </summary>
internal sealed partial class CorDebugSession : IAsyncDisposable {
	readonly List<string> recentOutput = new();

	ICorDebug? corDebug;
	ICorDebugProcess? process;
	CorDebugEventPump? pump;
	Process? debuggee;
	IntPtr unregisterToken;
	bool disposed;

	public string Id { get; } = Guid.NewGuid().ToString("N");

	public CorDebugDispatcher Dispatcher { get; } = new();

	public ModuleTable Modules { get; } = new();

	public ThreadTable Threads { get; } = new();

	public string? WorkspaceId { get; private init; }

	/// <summary>Resolves decompiled-source coordinates to IL identities. May be null.</summary>
	public IDebugSymbolResolver? SymbolResolver { get; private init; }

	/// <summary>Absolute path of the program being launched, used to recognise its module.</summary>
	public string? LaunchProgram { get; private init; }

	/// <summary>True when the launch asked for a stop before the first user statement runs.</summary>
	public bool StopAtEntry { get; private init; }

	/// <summary>
	/// True while a launch is being held back until the client has armed its breakpoints.
	///
	/// A launch that does not stop at the entry point has no stop of its own before user code, and
	/// the debuggee reaches it in the time the launch request itself takes to come back — a client
	/// that armed breakpoints afterwards would be arming them at a program that had already run.
	/// So the target is left suspended where the runtime stopped it and released by
	/// <c>configurationDone</c>. A launch that does break at the entry point needs none of this: the
	/// entry breakpoint is already a stop the client can arm behind.
	/// </summary>
	bool awaitingConfiguration;

	/// <summary>The debuggee PID, once known.</summary>
	public int TargetProcessId { get; private set; }

	/// <summary>
	/// True when this session started the debuggee and is therefore responsible for reaping it;
	/// an attached process is left running.
	/// </summary>
	public bool OwnsDebuggee { get; private init; }

	public bool IsStopped { get; private set; }

	public string? StopReason { get; private set; }

	public int? StoppedThreadId { get; private set; }

	public event EventHandler<SessionEvent>? EventReceived;

	public bool HasExited { get; private set; }

	// ---------------------------------------------------------------- lifecycle

	public static async Task<CorDebugSession> LaunchAsync(DebugLaunchRequest request, IDebugSymbolResolver? symbols, CancellationToken cancellationToken) {
		var program = Path.GetFullPath(request.Program);
		if (!File.Exists(program))
			throw new RpcException(ErrorCodes.FileNotFound, $"Debug target does not exist: {request.Program}");

		var session = new CorDebugSession {
			WorkspaceId = request.WorkspaceId,
			SymbolResolver = symbols,
			LaunchProgram = program,
			StopAtEntry = request.StopAtEntry,
			OwnsDebuggee = true,
		};
		// Held until the client is done arming breakpoints; see awaitingConfiguration.
		session.awaitingConfiguration = !request.StopAtEntry;
		Process? child = null;
		try {
			var startInfo = new ProcessStartInfo {
				FileName = "dotnet",
				WorkingDirectory = request.WorkingDirectory ?? Path.GetDirectoryName(program) ?? Environment.CurrentDirectory,
				UseShellExecute = false,
				// The debuggee must not inherit the host's stdio: stdin is the JSON-RPC request
				// stream and stdout is the response stream, so any write from the debuggee would
				// corrupt the protocol. Both are redirected and drained into output events.
				RedirectStandardInput = true,
				RedirectStandardOutput = true,
				RedirectStandardError = true,
			};
			startInfo.ArgumentList.Add(program);
			foreach (var argument in request.Arguments ?? [])
				startInfo.ArgumentList.Add(argument);
			// Suspends the runtime at startup so the debugger can attach before any user code runs.
			startInfo.Environment["DOTNET_DefaultDiagnosticPortSuspend"] = "1";
			foreach (var (key, value) in request.Environment ?? new Dictionary<string, string>())
				startInfo.Environment[key] = value;

			child = Process.Start(startInfo) ?? throw new RpcException(ErrorCodes.InternalError, "Could not start the debug target.");
			session.debuggee = child;
			session.TargetProcessId = child.Id;
			child.StandardInput.Close();
			session.HookOutput(child);

			// Registration must happen before the runtime is resumed, or the startup callback is lost.
			var startup = new RuntimeStartup.State();
			session.unregisterToken = RuntimeStartup.Register((uint)child.Id, startup);
			await ResumeRuntimeAsync(child.Id, cancellationToken).ConfigureAwait(false);

			var (corDebug, hResult) = await startup.Completion.Task
				.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken)
				.ConfigureAwait(false);
			startup.Release();
			if (corDebug is null || hResult < 0)
				throw new RpcException(ErrorCodes.InternalError, $"The runtime did not start: 0x{hResult:X8}");

			await session.AttachCorDebugAsync(corDebug, child.Id).ConfigureAwait(false);
			session.Emit(DebugEventNames.Process, new { systemProcessId = child.Id, name = Path.GetFileName(program) });
			return session;
		}
		catch {
			await session.DisposeAsync().ConfigureAwait(false);
			throw;
		}
	}

	public static async Task<CorDebugSession> AttachAsync(int processId, string? workspaceId, IDebugSymbolResolver? symbols, CancellationToken cancellationToken) {
		if (processId <= 0)
			throw new RpcException(ErrorCodes.InvalidParams, "A positive process ID is required.");
		// DebugActiveProcess resumes the target, so the CLR interfaces have to be obtained first.
		var corDebug = await Task.Run(() => CreateInterfaceForProcess(processId), cancellationToken).ConfigureAwait(false);
		var session = new CorDebugSession {
			WorkspaceId = workspaceId,
			SymbolResolver = symbols,
			TargetProcessId = processId,
		};
		try {
			session.debuggee = TryOpenProcess(processId);
			if (session.debuggee is not null)
				session.HookOutput(session.debuggee);
			await session.AttachCorDebugAsync(corDebug, processId).ConfigureAwait(false);
			return session;
		}
		catch {
			await session.DisposeAsync().ConfigureAwait(false);
			throw;
		}
	}

	async Task AttachCorDebugAsync(ICorDebug corDebugInstance, int processId) {
		corDebug = corDebugInstance;
		corDebug.Initialize();
		pump = new CorDebugEventPump(this);
		corDebug.SetManagedHandler(pump.Callbacks);
		process = corDebug.DebugActiveProcess(processId, false);
		TargetProcessId = processId;
		IsStopped = false;
		// Events delivered while DebugActiveProcess ran are already queued; draining starts now so
		// every one of them is answered with a Continue.
		pump.Start();
		await SeedThreadsAsync().ConfigureAwait(false);
	}

	/// <summary>
	/// Files the threads the process already had. The runtime announces every thread from here on, but
	/// the ones that predate the debugger are only in the process's own list — and on attach that is
	/// all of them, while the client asks for a thread to stop on as soon as it is connected.
	/// </summary>
	async Task SeedThreadsAsync() {
		if (process is null)
			return;
		await Dispatcher.RunAsync(() => {
			try {
				foreach (var thread in process.EnumerateThreads())
					Threads.Add(thread);
			}
			catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
				// A thread that went away between the enumeration and the read is not worth reporting.
			}
		}).ConfigureAwait(false);
	}

	static async Task ResumeRuntimeAsync(int processId, CancellationToken cancellationToken) {
		var client = new DiagnosticsClient(processId);
		for (var attempt = 1; ; attempt++) {
			try {
				client.ResumeRuntime();
				return;
			}
			catch (ServerNotAvailableException) when (attempt < 20) {
				// The runtime has not opened its diagnostic port yet.
			}
			catch (ServerErrorException) {
				// Already resumed: nothing left to release.
				return;
			}
			await Task.Delay(50, cancellationToken).ConfigureAwait(false);
		}
	}

	/// <summary>
	/// Behind <c>CreateDebuggingInterfaceFromVersionEx</c> on Linux are two quirks that cost real
	/// debugging time, so they are spelled out here:
	/// <list type="bullet">
	/// <item>the version argument has to be in 3..5; the Windows <c>CorDebugVersion</c> constants
	/// (1 and 2) are rejected with <c>E_INVALIDARG</c>.</item>
	/// <item>the version <em>string</em> is not the module path that <c>EnumerateCLRs</c> hands
	/// back — that path has to go through <c>CreateVersionStringFromModule</c> first.</item>
	/// </list>
	/// </summary>
	const int DebuggerVersion = 4;

	static ICorDebug CreateInterfaceForProcess(int processId) {
		var hr = DbgShim.EnumerateCLRs((uint)processId, out var handleArray, out var stringArray, out var count);
		if (hr < 0)
			throw new RpcException(ErrorCodes.InvalidParams, $"Could not enumerate the CLR instances in process {processId}: 0x{hr:X8}");
		if (count == 0)
			throw new RpcException(ErrorCodes.InvalidParams, $"No CLR was found in process {processId}.");
		try {
			var buffer = new char[512];
			for (var i = 0; i < (int)count; i++) {
				var modulePath = Marshal.PtrToStringUni(Marshal.ReadIntPtr(stringArray, i * IntPtr.Size));
				if (string.IsNullOrEmpty(modulePath))
					continue;
				var versionHr = DbgShim.CreateVersionStringFromModule((uint)processId, modulePath, buffer, (uint)buffer.Length, out var length);
				if (versionHr < 0)
					continue;
				var version = new string(buffer, 0, (int)Math.Min(length, (uint)buffer.Length)).TrimEnd('\0');
				if (DbgShim.CreateDebuggingInterfaceFromVersionEx(DebuggerVersion, version, out var corDebug) >= 0 && corDebug is not null)
					return corDebug;
			}
		}
		finally {
			DbgShim.CloseCLREnumeration(handleArray, stringArray, count);
		}
		throw new RpcException(ErrorCodes.InternalError, $"Could not attach to the CLR in process {processId}.");
	}

	static Process? TryOpenProcess(int processId) {
		try {
			return Process.GetProcessById(processId);
		}
		catch (ArgumentException) {
			return null;
		}
	}

	void HookOutput(Process child) {
		child.OutputDataReceived += (_, e) => EmitOutput(e.Data, "stdout");
		child.ErrorDataReceived += (_, e) => EmitOutput(e.Data, "stderr");
		child.EnableRaisingEvents = true;
		try {
			child.BeginOutputReadLine();
			child.BeginErrorReadLine();
		}
		catch (InvalidOperationException) {
			// Attached process: its streams are not redirected.
		}
	}

	void EmitOutput(string? line, string category) {
		if (line is null)
			return;
		Emit(DebugEventNames.Output, new { category, output = line + "\n" });
	}

	// ---------------------------------------------------------------- event handlers

	/// <summary>
	/// Runs on the dispatcher for every event the runtime raises. Events the engine does not care
	/// about fall through; <see cref="AfterEventProcessed"/> still resumes the process afterwards.
	/// </summary>
	public void HandleEvent(CorDebugManagedCallbackEventArgs e) {
		switch (e) {
			case CreateThreadCorDebugManagedCallbackEventArgs createThread:
				Threads.Add(createThread.Thread);
				break;
			case ExitThreadCorDebugManagedCallbackEventArgs exitThread:
				Threads.Remove(exitThread.Thread);
				break;
			case LoadModuleCorDebugManagedCallbackEventArgs loadModule:
				Modules.Add(loadModule.Module);
				OnModuleLoaded(loadModule.Module);
				ArmEntryBreakpoint(loadModule.Module);
				break;
			case UnloadModuleCorDebugManagedCallbackEventArgs unloadModule:
				Modules.Remove(unloadModule.Module);
				break;
			case BreakpointCorDebugManagedCallbackEventArgs hit:
				OnBreakpointHit(hit.Breakpoint, hit.Thread);
				break;
			case StepCompleteCorDebugManagedCallbackEventArgs step:
				Stop(StopReasons.Step, step.Thread);
				break;
			case BreakCorDebugManagedCallbackEventArgs pause:
				Stop(StopReasons.Pause, pause.Thread);
				break;
			case BreakpointSetErrorCorDebugManagedCallbackEventArgs error:
				OnBreakpointSetError(error.Breakpoint, error.DwError);
				break;
			case DebuggerErrorCorDebugManagedCallbackEventArgs debuggerError:
				DebugLog.Error("debugger-error", new COMException($"The debugger reported error 0x{debuggerError.ErrorCode:X8}.", debuggerError.ErrorHR));
				break;
			case ExitProcessCorDebugManagedCallbackEventArgs:
				HasExited = true;
				IsStopped = false;
				Emit(DebugEventNames.Exited, new { exitCode = TryGetExitCode() });
				Emit(DebugEventNames.Terminated, new { restart = false });
				break;
		}
	}

	int? TryGetExitCode() {
		try {
			return debuggee?.HasExited == true ? debuggee.ExitCode : null;
		}
		catch (InvalidOperationException) {
			return null;
		}
	}

	void Stop(string reason, ICorDebugThread? thread, string? breakpointId = null) {
		// A stop ends whatever step was in flight — the step's own breakpoint hitting is one way for
		// it to end — and the frames and values the previous stop handed out die with it: their COM
		// objects belong to a suspension that no longer exists.
		CancelStepping();
		frameTable.Clear();
		variableTable.Clear();
		IsStopped = true;
		StopReason = reason;
		StoppedThreadId = thread is null ? null : ThreadTable.TryGetId(thread);
		Emit(DebugEventNames.Stopped, new {
			reason,
			threadId = StoppedThreadId,
			allThreadsStopped = true,
			hitBreakpointIds = breakpointId is null ? [] : new[] { breakpointId },
		});
	}

	/// <summary>
	/// Called after every callback. The runtime delivers no further events while the debuggee is
	/// suspended, so anything not deliberately stopped must be resumed immediately.
	/// </summary>
	public void AfterEventProcessed() {
		if (HasExited || IsStopped || awaitingConfiguration || process is null)
			return;
		try {
			if (!process.IsRunning)
				process.Continue(false);
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			// The process went away between the event and the resume.
		}
	}

	// Implemented in CorDebugSession.Breakpoints.cs, which is where the breakpoint table lives.
	partial void OnModuleLoaded(ICorDebugModule module);

	partial void OnBreakpointHit(ICorDebugBreakpoint breakpoint, ICorDebugThread thread);

	partial void OnBreakpointSetError(ICorDebugBreakpoint breakpoint, uint dwError);

	// ---------------------------------------------------------------- commands

	public async Task<JsonElement> ExecuteAsync(string command, JsonElement? arguments, CancellationToken cancellationToken) {
		// Breakpoint requests resolve source coordinates to IL first, which means decompiling, and
		// that must not happen on the dispatcher: the debuggee is suspended while it runs, but the
		// event pump would stop draining callbacks until it finished. Everything else is cheap and
		// touches COM state, so it stays serialised on the dispatcher.
		switch (command) {
			case "setBreakpoints":
				return await SetBreakpointsAsync(arguments, cancellationToken).ConfigureAwait(false);
			case "setFunctionBreakpoints":
				return await SetFunctionBreakpointsAsync(arguments, cancellationToken).ConfigureAwait(false);
			// The stack and the values in it are only named by the resolver, which decompiles; that
			// has to happen off the dispatcher for the same reason breakpoint resolution does.
			case "stackTrace":
				return await StackTraceAsync(arguments, cancellationToken).ConfigureAwait(false);
			case "variables":
				return await VariablesAsync(arguments, cancellationToken).ConfigureAwait(false);
			// A step picks its landing sites before it resumes, so it decompiles too.
			case "next":
			case "stepIn":
			case "stepOut":
				return await StepAsync(command, arguments, cancellationToken).ConfigureAwait(false);
			default:
				return await Dispatcher.RunAsync(() => Execute(command, arguments, cancellationToken)).ConfigureAwait(false);
		}
	}

	JsonElement Execute(string command, JsonElement? arguments, CancellationToken cancellationToken) {
		cancellationToken.ThrowIfCancellationRequested();
		switch (command) {
			case "configurationDone":
				// The client's breakpoints are in place, so the target may run: this is the release for
				// a launch that was held because it does not break at the entry point.
				if (awaitingConfiguration) {
					awaitingConfiguration = false;
					ResumeProcess();
				}
				return EmptyJson();
			case "continue":
				return Continue();
			case "pause":
				return Pause();
			case "threads":
				return ThreadsResponse();
			case "modules":
				return ModulesResponse();
			case "setExceptionBreakpoints":
				// Exception breakpoints are outside the v1 engine; the client disables the UI from
				// the capabilities reported at launch time.
				return EmptyJson();
			case "evaluate":
				throw new RpcException(ErrorCodes.MethodNotFound, "Expression evaluation is not supported by the in-process debug engine.");
			case "scopes":
				return Scopes(arguments);
			// stackTrace, variables and the step commands are answered in ExecuteAsync: every one of
			// them needs the symbol resolver, which must not run while the event pump is held.
			default:
				throw new RpcException(ErrorCodes.InvalidParams, $"Unknown debug command: {command}");
		}
	}

	JsonElement Continue() {
		if (process is null || HasExited)
			return EmptyJson();
		CancelStepping();
		ResumeProcess();
		return EmptyJson();
	}

	/// <summary>
	/// Marks the process running again and tells the client it has. The caller decides what to
	/// cancel first: <c>continue</c> drops any step in flight, while a step keeps the breakpoints it
	/// has just armed.
	/// </summary>
	void ResumeProcess() {
		IsStopped = false;
		StopReason = null;
		StoppedThreadId = null;
		frameTable.Clear();
		variableTable.Clear();
		Emit(DebugEventNames.Continued, new { threadId = (int?)null, allThreadsContinued = true });
		try {
			if (process is not null && !process.IsRunning)
				process.Continue(false);
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			// Already running or already gone.
		}
	}

	JsonElement Pause() {
		if (process is null || HasExited)
			return EmptyJson();
		// The timeout argument is ignored by the runtime (hence its name). WPF passes uint.MaxValue
		// here, but the generated interop rejects a negative int, so pass 0.
		process.Stop(0);
		// A debugger-requested break does not raise a Break callback on Linux, so the stopped
		// state is recorded here instead of waiting for one. WPF does the same: TryBreakProcesses
		// calls Stop and then marks the process stopped itself.
		if (!IsStopped) {
			var threads = Threads.Snapshot();
			Stop(StopReasons.Pause, threads.Count == 0 ? null : threads[0].Thread);
		}
		return EmptyJson();
	}

	JsonElement ThreadsResponse() => JsonSerializer.SerializeToElement(new {
		threads = Threads.Snapshot().Select(pair => new { id = pair.Id, name = ThreadTable.Describe(pair.Id) }).ToArray(),
	});

	JsonElement ModulesResponse() => JsonSerializer.SerializeToElement(new {
		modules = Modules.Snapshot(),
		totalModules = Modules.Snapshot().Count,
	});

	static JsonElement EmptyJson() => JsonSerializer.SerializeToElement(new { });

	// ---------------------------------------------------------------- shutdown

	public async Task DisconnectAsync(bool terminateDebuggee, CancellationToken cancellationToken) {
		await Dispatcher.RunAsync(() => {
			CancelStepping();
			breakpoints.Clear();
			Modules.Clear();
			Threads.Clear();
			frameTable.Clear();
			variableTable.Clear();
			if (process is not null && !HasExited) {
				try {
					if (terminateDebuggee)
						process.Terminate(0);
					else
						process.Detach();
				}
				catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
					// The debuggee is already gone.
				}
			}
		}).ConfigureAwait(false);
		await DisposeAsync().ConfigureAwait(false);
	}

	public async ValueTask DisposeAsync() {
		if (disposed)
			return;
		disposed = true;
		if (unregisterToken != IntPtr.Zero) {
			DbgShim.UnregisterForRuntimeStartup(unregisterToken);
			unregisterToken = IntPtr.Zero;
		}
		pump?.Dispose();
		pump = null;
		try {
			corDebug?.Terminate();
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			// Nothing left to terminate.
		}
		corDebug = null;
		process = null;
		KillDebuggee();
		Dispatcher.Dispose();
		await Task.CompletedTask.ConfigureAwait(false);
	}

	void KillDebuggee() {
		if (debuggee is null)
			return;
		// A detached debuggee keeps running; only a process we started is ours to reap.
		if (!OwnsDebuggee) {
			debuggee.Dispose();
			debuggee = null;
			return;
		}
		try {
			if (!debuggee.HasExited)
				debuggee.Kill(entireProcessTree: true);
		}
		catch (Exception ex) when (ex is InvalidOperationException or NotSupportedException or System.ComponentModel.Win32Exception) {
			// Already gone.
		}
		finally {
			debuggee.Dispose();
			debuggee = null;
		}
	}

	void Emit(string eventName, object? body) => EventReceived?.Invoke(this, new SessionEvent(eventName, body));

	/// <summary>Records a line of debuggee output for <c>disconnect</c> diagnostics.</summary>
	public void NoteOutput(string line) {
		lock (recentOutput) {
			recentOutput.Add(line);
			if (recentOutput.Count > 100)
				recentOutput.RemoveAt(0);
		}
	}
}
