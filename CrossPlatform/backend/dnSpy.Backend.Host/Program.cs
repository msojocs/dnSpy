using System.Diagnostics;
using dnSpy.Backend.Core;
using dnSpy.Backend.Debugging.Dap;
using dnSpy.Backend.Host;

var options = HostOptions.Parse(args);
using var shutdown = new CancellationTokenSource();
using var workspaceManager = new WorkspaceManager();
await using var debugManager = DebugManagerFactory.TryCreate();
using var cancelHandler = new ConsoleCancelHandler(shutdown);

if (options.ParentProcessId is int parentProcessId)
	_ = ParentProcessMonitor.StopWhenParentExitsAsync(parentProcessId, shutdown);

var server = new JsonRpcServer(
	Console.OpenStandardInput(),
	Console.OpenStandardOutput(),
	workspaceManager,
	debugManager,
	options,
	shutdown);

try {
	await server.RunAsync(shutdown.Token).ConfigureAwait(false);
	return 0;
}
catch (OperationCanceledException) when (shutdown.IsCancellationRequested) {
	return 0;
}
catch (Exception ex) {
	HostLog.Error("host-failed", ex);
	return 1;
}

namespace dnSpy.Backend.Host {
	internal sealed record HostOptions(string? Nonce, int? ParentProcessId) {
		public static HostOptions Parse(string[] args) {
			string? nonce = null;
			int? parentProcessId = null;
			for (var i = 0; i < args.Length; i++) {
				switch (args[i]) {
					case "--nonce" when i + 1 < args.Length:
						nonce = args[++i];
						break;
					case "--parent-pid" when i + 1 < args.Length && int.TryParse(args[++i], out var pid):
						parentProcessId = pid;
						break;
				}
			}
			return new HostOptions(nonce, parentProcessId);
		}
	}

	internal sealed class ConsoleCancelHandler : IDisposable {
		readonly CancellationTokenSource shutdown;

		public ConsoleCancelHandler(CancellationTokenSource shutdown) {
			this.shutdown = shutdown;
			Console.CancelKeyPress += OnCancelKeyPress;
		}

		void OnCancelKeyPress(object? sender, ConsoleCancelEventArgs e) {
			e.Cancel = true;
			shutdown.Cancel();
		}

		public void Dispose() => Console.CancelKeyPress -= OnCancelKeyPress;
	}

	internal static class ParentProcessMonitor {
		public static async Task StopWhenParentExitsAsync(int parentProcessId, CancellationTokenSource shutdown) {
			try {
				using var parent = Process.GetProcessById(parentProcessId);
				await parent.WaitForExitAsync(shutdown.Token).ConfigureAwait(false);
				await shutdown.CancelAsync().ConfigureAwait(false);
			}
			catch (ArgumentException) {
				await shutdown.CancelAsync().ConfigureAwait(false);
			}
			catch (OperationCanceledException) {
			}
			catch (Exception ex) {
				HostLog.Error("parent-monitor-failed", ex);
			}
		}
	}

	internal static class DebugManagerFactory {
		public static DebugSessionManager? TryCreate() {
			try {
				return new DebugSessionManager();
			}
			catch (FileNotFoundException ex) {
				HostLog.Error("debugger-unavailable", ex);
				return null;
			}
		}
	}
}
