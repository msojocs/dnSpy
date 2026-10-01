using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Debugging.Dap;

public sealed class DebugSessionManager : IAsyncDisposable {
	static readonly HashSet<string> AllowedCommands = new(StringComparer.Ordinal) {
		"setBreakpoints",
		"setFunctionBreakpoints",
		"setExceptionBreakpoints",
		"configurationDone",
		"continue",
		"pause",
		"next",
		"stepIn",
		"stepOut",
		"threads",
		"stackTrace",
		"scopes",
		"variables",
		"evaluate",
		"modules",
		"source",
	};
	readonly ConcurrentDictionary<string, DebugSession> sessions = new(StringComparer.Ordinal);
	readonly string netCoreDbgPath;

	public DebugSessionManager(string? explicitPath = null) => netCoreDbgPath = NetCoreDbgLocator.Find(explicitPath);

	public event EventHandler<DebugEventNotification>? EventReceived;

	public IReadOnlyList<DebugProcessDto> ListProcesses() {
		var processes = new List<DebugProcessDto>();
		foreach (var process in Process.GetProcesses()) {
			using (process) {
				try {
					if (process.Id == Environment.ProcessId || process.HasExited)
						continue;
					string? executablePath;
					try { executablePath = process.MainModule?.FileName; }
					catch { executablePath = null; }
					processes.Add(new DebugProcessDto(process.Id, process.ProcessName, executablePath));
				}
				catch (InvalidOperationException) {
				}
			}
		}
		return processes.OrderBy(process => process.Name, StringComparer.OrdinalIgnoreCase).ThenBy(process => process.ProcessId).ToArray();
	}

	public async Task<DebugStartResponse> LaunchAsync(DebugLaunchRequest request, CancellationToken cancellationToken) {
		if (!File.Exists(request.Program))
			throw new RpcException(ErrorCodes.FileNotFound, $"Debug target does not exist: {request.Program}");
		var session = CreateSession();
		try {
			var capabilities = await session.InitializeAsync(cancellationToken).ConfigureAwait(false);
			var launchTask = session.Connection.SendRequestAsync("launch", new {
				name = Path.GetFileName(request.Program),
				type = "coreclr",
				request = "launch",
				program = Path.GetFullPath(request.Program),
				args = request.Arguments ?? [],
				cwd = request.WorkingDirectory ?? Path.GetDirectoryName(Path.GetFullPath(request.Program)),
				stopAtEntry = request.StopAtEntry,
				env = request.Environment,
			}, cancellationToken);
			await session.Connection.WaitForInitializedAsync(cancellationToken).ConfigureAwait(false);
			await session.Connection.SendRequestAsync("configurationDone", new { }, cancellationToken).ConfigureAwait(false);
			await launchTask.ConfigureAwait(false);
			return new DebugStartResponse(session.Id, capabilities);
		}
		catch {
			await RemoveAndDisposeAsync(session.Id).ConfigureAwait(false);
			throw;
		}
	}

	public async Task<DebugStartResponse> AttachAsync(DebugAttachRequest request, CancellationToken cancellationToken) {
		if (request.ProcessId <= 0)
			throw new RpcException(ErrorCodes.InvalidParams, "A positive process ID is required.");
		var session = CreateSession();
		try {
			var capabilities = await session.InitializeAsync(cancellationToken).ConfigureAwait(false);
			var attachTask = session.Connection.SendRequestAsync("attach", new { processId = request.ProcessId }, cancellationToken);
			await session.Connection.WaitForInitializedAsync(cancellationToken).ConfigureAwait(false);
			await session.Connection.SendRequestAsync("configurationDone", new { }, cancellationToken).ConfigureAwait(false);
			await attachTask.ConfigureAwait(false);
			return new DebugStartResponse(session.Id, capabilities);
		}
		catch {
			await RemoveAndDisposeAsync(session.Id).ConfigureAwait(false);
			throw;
		}
	}

	public async Task<DebugAdapterResponse> RequestAsync(DebugAdapterRequest request, CancellationToken cancellationToken) {
		if (!AllowedCommands.Contains(request.Command))
			throw new RpcException(ErrorCodes.InvalidParams, $"Debug adapter command is not allowed: {request.Command}");
		var session = GetSession(request.SessionId);
		if (request.Command == "modules") {
			var modules = session.GetModules();
			return new DebugAdapterResponse(JsonSerializer.SerializeToElement(new { modules, totalModules = modules.Count }));
		}
		var body = await session.Connection.SendRequestAsync(request.Command, request.Arguments, cancellationToken).ConfigureAwait(false);
		return new DebugAdapterResponse(body);
	}

	public async Task DisconnectAsync(DebugDisconnectRequest request, CancellationToken cancellationToken) {
		var session = GetSession(request.SessionId);
		try {
			await session.Connection.SendRequestAsync("disconnect", new {
				restart = false,
				terminateDebuggee = request.TerminateDebuggee,
			}, cancellationToken).ConfigureAwait(false);
		}
		catch (InvalidOperationException) when (session.Connection.ExitedSuccessfully) {
			// netcoredbg can exit cleanly before flushing the disconnect response.
		}
		finally {
			await RemoveAndDisposeAsync(session.Id).ConfigureAwait(false);
		}
	}

	DebugSession CreateSession() {
		var session = new DebugSession(netCoreDbgPath);
		session.EventReceived += Session_EventReceived;
		if (!sessions.TryAdd(session.Id, session))
			throw new InvalidOperationException("Could not register the debug session.");
		return session;
	}

	void Session_EventReceived(object? sender, DapEvent e) {
		if (sender is not DebugSession session)
			return;
		EventReceived?.Invoke(this, new DebugEventNotification(session.Id, e.Event, e.Body));
		if (e.Event == "terminated")
			_ = DisposeTerminatedSessionAsync(session.Id);
	}

	async Task DisposeTerminatedSessionAsync(string sessionId) {
		// Let the adapter flush the response that often follows its terminated event.
		await Task.Delay(1000).ConfigureAwait(false);
		await RemoveAndDisposeAsync(sessionId).ConfigureAwait(false);
	}

	DebugSession GetSession(string id) => sessions.TryGetValue(id, out var session)
		? session
		: throw new RpcException(ErrorCodes.InvalidParams, "The debug session no longer exists.");

	async Task RemoveAndDisposeAsync(string id) {
		if (sessions.TryRemove(id, out var session)) {
			session.EventReceived -= Session_EventReceived;
			await session.DisposeAsync().ConfigureAwait(false);
		}
	}

	public async ValueTask DisposeAsync() {
		var active = sessions.Keys.ToArray();
		foreach (var id in active)
			await RemoveAndDisposeAsync(id).ConfigureAwait(false);
	}

	sealed class DebugSession : IAsyncDisposable {
		public DebugSession(string executable) {
			Id = Guid.NewGuid().ToString("N");
			Connection = new DapConnection(executable);
			Connection.EventReceived += Connection_EventReceived;
		}

		public string Id { get; }
		public DapConnection Connection { get; }
		public event EventHandler<DapEvent>? EventReceived;

		public async Task<JsonElement> InitializeAsync(CancellationToken cancellationToken) => await Connection.SendRequestAsync("initialize", new {
			clientID = "dnspy",
			clientName = "dnSpy",
			adapterID = "coreclr",
			pathFormat = "path",
			linesStartAt1 = true,
			columnsStartAt1 = true,
			supportsVariableType = true,
			supportsVariablePaging = true,
			supportsRunInTerminalRequest = false,
			locale = "en-US",
		}, cancellationToken).ConfigureAwait(false);

		public int? TargetProcessId { get; private set; }

		void Connection_EventReceived(object? sender, DapEvent e) {
			if (e.Event == "process" && e.Body is { } body && body.TryGetProperty("systemProcessId", out var processId) && processId.TryGetInt32(out var id))
				TargetProcessId = id;
			EventReceived?.Invoke(this, e);
		}

		public IReadOnlyList<DebugModuleDto> GetModules() {
			if (TargetProcessId is not int processId)
				return Array.Empty<DebugModuleDto>();
			try {
				if (OperatingSystem.IsLinux())
					return GetLinuxModules(processId);
				using var target = Process.GetProcessById(processId);
				return target.Modules.Cast<ProcessModule>()
					.Select(module => new DebugModuleDto(module.FileName, module.ModuleName, module.FileName, module.FileVersionInfo.FileVersion, "Unknown"))
					.ToArray();
			}
			catch (Exception ex) when (ex is InvalidOperationException or IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception) {
				return Array.Empty<DebugModuleDto>();
			}
		}

		static IReadOnlyList<DebugModuleDto> GetLinuxModules(int processId) {
			var paths = new HashSet<string>(StringComparer.Ordinal);
			foreach (var line in File.ReadLines($"/proc/{processId}/maps")) {
				var pathStart = line.IndexOf('/');
				if (pathStart < 0)
					continue;
				var path = line[pathStart..];
				if (path.EndsWith(" (deleted)", StringComparison.Ordinal))
					path = path[..^10];
				var extension = Path.GetExtension(path);
				if (extension.Equals(".dll", StringComparison.OrdinalIgnoreCase) ||
					extension.Equals(".so", StringComparison.OrdinalIgnoreCase) ||
					path.Contains(".so.", StringComparison.OrdinalIgnoreCase))
					paths.Add(path);
			}
			return paths.Order(StringComparer.OrdinalIgnoreCase)
				.Select(path => new DebugModuleDto(path, Path.GetFileName(path), path, null, "Loaded"))
				.ToArray();
		}

		public async ValueTask DisposeAsync() {
			Connection.EventReceived -= Connection_EventReceived;
			await Connection.DisposeAsync().ConfigureAwait(false);
		}
	}
}

internal static class NetCoreDbgLocator {
	public static string Find(string? explicitPath) {
		var candidates = new List<string?> {
			explicitPath,
			Environment.GetEnvironmentVariable("DNSPY_NETCOREDBG_PATH"),
			Path.Combine(AppContext.BaseDirectory, "debugger", "netcoredbg"),
		};
		var directory = new DirectoryInfo(AppContext.BaseDirectory);
		while (directory is not null) {
			candidates.Add(Path.Combine(directory.FullName, ".tools", "netcoredbg", "netcoredbg"));
			directory = directory.Parent;
		}
		var pathVariable = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
		candidates.AddRange(pathVariable.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries).Select(path => Path.Combine(path, "netcoredbg")));
		var found = candidates.FirstOrDefault(candidate => !string.IsNullOrWhiteSpace(candidate) && File.Exists(candidate));
		return found is not null
			? Path.GetFullPath(found)
			: throw new FileNotFoundException("netcoredbg was not found. Set DNSPY_NETCOREDBG_PATH or install the bundled debugger.");
	}
}
