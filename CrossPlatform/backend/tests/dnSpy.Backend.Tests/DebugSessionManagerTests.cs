using System.Diagnostics;
using System.Text.Json;
using dnSpy.Backend.Contracts;
using dnSpy.Backend.Debugging.Dap;
using Xunit;

namespace dnSpy.Backend.Tests;

public sealed class DebugSessionManagerTests {
	[Fact(Timeout = 30_000)]
	public async Task LaunchesCoreClrAndProvidesThreadsStackAndVariables() {
		var debuggerPath = FindDebugger();
		await using var manager = new DebugSessionManager(debuggerPath);
		var stoppedEvents = new Queue<DebugEventNotification>();
		var eventSignal = new SemaphoreSlim(0);
		manager.EventReceived += (_, notification) => {
			if (notification.Event == "stopped") {
				lock (stoppedEvents)
					stoppedEvents.Enqueue(notification);
				eventSignal.Release();
			}
		};

		var target = FindTarget();
		var started = await manager.LaunchAsync(
			new DebugLaunchRequest(target, StopAtEntry: true),
			TestContext.Current.CancellationToken);
		await eventSignal.WaitAsync(TestContext.Current.CancellationToken);
		var entryStop = Dequeue(stoppedEvents);
		Assert.Equal("entry", entryStop.Body?.GetProperty("reason").GetString());

		var functionBreakpoints = JsonSerializer.SerializeToElement(new {
			breakpoints = new[] { new { name = "DebugTarget.Program.Calculate" } },
		});
		var breakpointResponse = await manager.RequestAsync(
			new DebugAdapterRequest(started.SessionId, "setFunctionBreakpoints", functionBreakpoints),
			TestContext.Current.CancellationToken);
		Assert.True(breakpointResponse.Body?.GetProperty("breakpoints")[0].GetProperty("verified").GetBoolean());

		var entryThreadId = entryStop.Body?.GetProperty("threadId").GetInt32() ?? throw new InvalidOperationException("Stopped event has no thread ID.");
		await manager.RequestAsync(
			new DebugAdapterRequest(started.SessionId, "continue", JsonSerializer.SerializeToElement(new { threadId = entryThreadId })),
			TestContext.Current.CancellationToken);
		await eventSignal.WaitAsync(TestContext.Current.CancellationToken);
		var breakpointStop = Dequeue(stoppedEvents);
		Assert.Equal("breakpoint", breakpointStop.Body?.GetProperty("reason").GetString());
		var threadId = breakpointStop.Body?.GetProperty("threadId").GetInt32() ?? entryThreadId;

		var threads = await manager.RequestAsync(
			new DebugAdapterRequest(started.SessionId, "threads", JsonSerializer.SerializeToElement(new { })),
			TestContext.Current.CancellationToken);
		Assert.NotEmpty(threads.Body?.GetProperty("threads").EnumerateArray() ?? []);

		var stack = await manager.RequestAsync(
			new DebugAdapterRequest(started.SessionId, "stackTrace", JsonSerializer.SerializeToElement(new { threadId, startFrame = 0, levels = 20 })),
			TestContext.Current.CancellationToken);
		var frame = stack.Body?.GetProperty("stackFrames")[0] ?? throw new InvalidOperationException("No stack frame was returned.");
		Assert.Contains("Calculate", frame.GetProperty("name").GetString(), StringComparison.Ordinal);

		var scopes = await manager.RequestAsync(
			new DebugAdapterRequest(started.SessionId, "scopes", JsonSerializer.SerializeToElement(new { frameId = frame.GetProperty("id").GetInt32() })),
			TestContext.Current.CancellationToken);
		var localScope = scopes.Body?.GetProperty("scopes").EnumerateArray().First(scope => scope.GetProperty("name").GetString() == "Locals")
			?? throw new InvalidOperationException("No locals scope was returned.");
		var variables = await manager.RequestAsync(
			new DebugAdapterRequest(started.SessionId, "variables", JsonSerializer.SerializeToElement(new { variablesReference = localScope.GetProperty("variablesReference").GetInt32() })),
			TestContext.Current.CancellationToken);
		var variableNames = variables.Body?.GetProperty("variables").EnumerateArray().Select(variable => variable.GetProperty("name").GetString()).ToArray() ?? [];
		Assert.Contains("left", variableNames);
		Assert.Contains("right", variableNames);

		var modules = await manager.RequestAsync(
			new DebugAdapterRequest(started.SessionId, "modules", JsonSerializer.SerializeToElement(new { startModule = 0, moduleCount = 1000 })),
			TestContext.Current.CancellationToken);
		Assert.NotEmpty(modules.Body?.GetProperty("modules").EnumerateArray() ?? []);

		await manager.DisconnectAsync(
			new DebugDisconnectRequest(started.SessionId, TerminateDebuggee: true),
			TestContext.Current.CancellationToken);
	}

	[Fact(Timeout = 30_000)]
	public async Task AttachesToAndDetachesFromExistingCoreClrProcess() {
		using var target = new Process {
			StartInfo = new ProcessStartInfo {
				FileName = "dotnet",
				UseShellExecute = false,
				RedirectStandardOutput = true,
				RedirectStandardError = true,
				CreateNoWindow = true,
			},
		};
		target.StartInfo.ArgumentList.Add(FindTarget());
		target.StartInfo.ArgumentList.Add("--wait");
		Assert.True(target.Start());
		try {
			var ready = await target.StandardOutput.ReadLineAsync(TestContext.Current.CancellationToken);
			Assert.Equal("READY", ready);
			await using var manager = new DebugSessionManager(FindDebugger());
			var stopped = new TaskCompletionSource<DebugEventNotification>(TaskCreationOptions.RunContinuationsAsynchronously);
			manager.EventReceived += (_, notification) => {
				if (notification.Event == "stopped") stopped.TrySetResult(notification);
			};
			var attached = await manager.AttachAsync(new DebugAttachRequest(target.Id), TestContext.Current.CancellationToken);
			var threads = await manager.RequestAsync(
				new DebugAdapterRequest(attached.SessionId, "threads", JsonSerializer.SerializeToElement(new { })),
				TestContext.Current.CancellationToken);
			var thread = threads.Body?.GetProperty("threads")[0] ?? throw new InvalidOperationException("No target thread was returned.");
			var threadId = thread.GetProperty("id").GetInt32();
			await manager.RequestAsync(
				new DebugAdapterRequest(attached.SessionId, "pause", JsonSerializer.SerializeToElement(new { threadId })),
				TestContext.Current.CancellationToken);
			var stop = await stopped.Task.WaitAsync(TestContext.Current.CancellationToken);
			Assert.Equal("pause", stop.Body?.GetProperty("reason").GetString());
			var stack = await manager.RequestAsync(
				new DebugAdapterRequest(attached.SessionId, "stackTrace", JsonSerializer.SerializeToElement(new { threadId, startFrame = 0, levels = 20 })),
				TestContext.Current.CancellationToken);
			Assert.NotEmpty(stack.Body?.GetProperty("stackFrames").EnumerateArray() ?? []);
			await manager.DisconnectAsync(
				new DebugDisconnectRequest(attached.SessionId, TerminateDebuggee: false),
				TestContext.Current.CancellationToken);
			Assert.False(target.HasExited);
		}
		finally {
			if (!target.HasExited) {
				target.Kill(entireProcessTree: true);
				await target.WaitForExitAsync(TestContext.Current.CancellationToken);
			}
		}
	}

	static DebugEventNotification Dequeue(Queue<DebugEventNotification> events) {
		lock (events)
			return events.Dequeue();
	}

	static string FindDebugger() {
		var path = Path.GetFullPath(Path.Combine(
			AppContext.BaseDirectory,
			"..", "..", "..", "..", "..", "..",
			".tools", "netcoredbg", "netcoredbg"));
		return File.Exists(path) ? path : throw new FileNotFoundException("The pinned netcoredbg test dependency is missing.", path);
	}

	static string FindTarget() {
		var path = Path.GetFullPath(Path.Combine(
			AppContext.BaseDirectory,
			"..", "..", "..", "..", "DebugTarget", "bin", TestConfiguration, "net10.0", "DebugTarget.dll"));
		return File.Exists(path) ? path : throw new FileNotFoundException("The debug target was not built.", path);
	}

	static string TestConfiguration => new DirectoryInfo(AppContext.BaseDirectory).Parent?.Name
		?? throw new InvalidOperationException("Could not determine the test configuration.");
}
