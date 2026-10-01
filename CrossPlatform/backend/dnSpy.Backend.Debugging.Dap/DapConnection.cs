using System.Buffers;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace dnSpy.Backend.Debugging.Dap;

internal sealed class DapConnection : IAsyncDisposable {
	const int MaxHeaderLength = 8192;
	const int MaxMessageLength = 32 * 1024 * 1024;
	readonly Process process;
	readonly Stream input;
	readonly Stream output;
	readonly SemaphoreSlim outputGate = new(1, 1);
	readonly ConcurrentDictionary<int, TaskCompletionSource<DapResponse>> pending = new();
	readonly CancellationTokenSource lifetime = new();
	readonly TaskCompletionSource initialized = new(TaskCreationOptions.RunContinuationsAsynchronously);
	readonly Task readLoop;
	int sequence;

	public DapConnection(string executable) {
		process = new Process {
			StartInfo = new ProcessStartInfo {
				FileName = executable,
				WorkingDirectory = Path.GetDirectoryName(executable) ?? Environment.CurrentDirectory,
				UseShellExecute = false,
				RedirectStandardInput = true,
				RedirectStandardOutput = true,
				RedirectStandardError = true,
				CreateNoWindow = true,
			},
			EnableRaisingEvents = true,
		};
		process.StartInfo.ArgumentList.Add("--interpreter=vscode");
		if (!process.Start())
			throw new InvalidOperationException("Could not start netcoredbg.");
		input = process.StandardOutput.BaseStream;
		output = process.StandardInput.BaseStream;
		process.ErrorDataReceived += (_, args) => {
			if (!string.IsNullOrWhiteSpace(args.Data))
				Trace.TraceError("[netcoredbg] {0}", args.Data);
		};
		process.BeginErrorReadLine();
		process.Exited += (_, _) => Stop(new InvalidOperationException($"netcoredbg exited with code {process.ExitCode}."));
		readLoop = ReadLoopAsync(lifetime.Token);
	}

	public event EventHandler<DapEvent>? EventReceived;
	public bool ExitedSuccessfully => process.HasExited && process.ExitCode == 0;

	public Task WaitForInitializedAsync(CancellationToken cancellationToken) => initialized.Task.WaitAsync(cancellationToken);

	public async Task<JsonElement> SendRequestAsync(string command, object? arguments, CancellationToken cancellationToken) {
		var requestSequence = Interlocked.Increment(ref sequence);
		var completion = new TaskCompletionSource<DapResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
		if (!pending.TryAdd(requestSequence, completion))
			throw new InvalidOperationException("Could not register DAP request.");
		try {
			await WriteMessageAsync(new {
				seq = requestSequence,
				type = "request",
				command,
				arguments,
			}, cancellationToken).ConfigureAwait(false);
			var response = await completion.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
			if (!response.Success)
				throw new DapException(command, response.Message ?? "The debug adapter rejected the request.");
			return response.Body ?? EmptyObject();
		}
		finally {
			pending.TryRemove(requestSequence, out _);
		}
	}

	async Task ReadLoopAsync(CancellationToken cancellationToken) {
		try {
			while (!cancellationToken.IsCancellationRequested) {
				var payload = await ReadFrameAsync(cancellationToken).ConfigureAwait(false);
				if (payload is null)
					break;
				using var document = JsonDocument.Parse(payload);
				var root = document.RootElement;
				var type = root.GetProperty("type").GetString();
				if (type == "response") {
					var requestSequence = root.GetProperty("request_seq").GetInt32();
					if (pending.TryGetValue(requestSequence, out var completion)) {
						completion.TrySetResult(new DapResponse(
							root.GetProperty("success").GetBoolean(),
							root.TryGetProperty("message", out var message) ? message.GetString() : null,
							root.TryGetProperty("body", out var body) ? body.Clone() : null));
					}
				}
				else if (type == "event") {
					var eventName = root.GetProperty("event").GetString() ?? string.Empty;
					var body = root.TryGetProperty("body", out var eventBody) ? (JsonElement?)eventBody.Clone() : null;
					if (eventName == "initialized")
						initialized.TrySetResult();
					EventReceived?.Invoke(this, new DapEvent(eventName, body));
				}
			}
			Stop(new EndOfStreamException("The debug adapter closed its output stream."));
		}
		catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) {
		}
		catch (Exception ex) {
			Stop(ex);
		}
	}

	async Task WriteMessageAsync(object message, CancellationToken cancellationToken) {
		var payload = JsonSerializer.SerializeToUtf8Bytes(message, JsonOptions);
		var header = Encoding.ASCII.GetBytes($"Content-Length: {payload.Length}\r\n\r\n");
		await outputGate.WaitAsync(cancellationToken).ConfigureAwait(false);
		try {
			await output.WriteAsync(header, cancellationToken).ConfigureAwait(false);
			await output.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
			await output.FlushAsync(cancellationToken).ConfigureAwait(false);
		}
		finally {
			outputGate.Release();
		}
	}

	async Task<byte[]?> ReadFrameAsync(CancellationToken cancellationToken) {
		var headerBuffer = new ArrayBufferWriter<byte>();
		var state = 0;
		var oneByte = new byte[1];
		while (headerBuffer.WrittenCount < MaxHeaderLength) {
			var count = await input.ReadAsync(oneByte, cancellationToken).ConfigureAwait(false);
			if (count == 0)
				return headerBuffer.WrittenCount == 0 ? null : throw new EndOfStreamException("DAP header ended unexpectedly.");
			headerBuffer.Write(oneByte);
			state = (state, oneByte[0]) switch {
				(0, (byte)'\r') => 1,
				(1, (byte)'\n') => 2,
				(2, (byte)'\r') => 3,
				(3, (byte)'\n') => 4,
				(_, (byte)'\r') => 1,
				_ => 0,
			};
			if (state == 4)
				break;
		}
		if (state != 4)
			throw new InvalidDataException("DAP header is too large.");
		var header = Encoding.ASCII.GetString(headerBuffer.WrittenSpan);
		var contentLength = ParseContentLength(header);
		if (contentLength < 0 || contentLength > MaxMessageLength)
			throw new InvalidDataException("DAP payload is too large.");
		var rented = ArrayPool<byte>.Shared.Rent(contentLength);
		try {
			await input.ReadExactlyAsync(rented.AsMemory(0, contentLength), cancellationToken).ConfigureAwait(false);
			return rented.AsSpan(0, contentLength).ToArray();
		}
		finally {
			ArrayPool<byte>.Shared.Return(rented);
		}
	}

	static int ParseContentLength(string header) {
		foreach (var line in header.Split("\r\n", StringSplitOptions.RemoveEmptyEntries)) {
			var separator = line.IndexOf(':');
			if (separator >= 0 && line[..separator].Trim().Equals("Content-Length", StringComparison.OrdinalIgnoreCase) && int.TryParse(line[(separator + 1)..].Trim(), out var length))
				return length;
		}
		throw new InvalidDataException("DAP frame is missing Content-Length.");
	}

	void Stop(Exception exception) {
		if (lifetime.IsCancellationRequested)
			return;
		lifetime.Cancel();
		initialized.TrySetException(exception);
		foreach (var completion in pending.Values)
			completion.TrySetException(exception);
	}

	public async ValueTask DisposeAsync() {
		lifetime.Cancel();
		if (!process.HasExited) {
			process.StandardInput.Close();
			if (!process.WaitForExit(1000))
				process.Kill(entireProcessTree: true);
		}
		try {
			await readLoop.ConfigureAwait(false);
		}
		catch (OperationCanceledException) {
		}
		process.Dispose();
		outputGate.Dispose();
		lifetime.Dispose();
	}

	static JsonElement EmptyObject() => JsonDocument.Parse("{}").RootElement.Clone();

	static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
	sealed record DapResponse(bool Success, string? Message, JsonElement? Body);
}

internal sealed record DapEvent(string Event, JsonElement? Body);

internal sealed class DapException(string command, string message) : Exception($"{command}: {message}");
