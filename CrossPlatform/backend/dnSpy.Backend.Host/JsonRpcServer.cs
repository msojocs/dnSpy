using System.Buffers;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using dnSpy.Backend.Contracts;
using dnSpy.Backend.Core;
using dnSpy.Backend.Debugging.CorDebug;

namespace dnSpy.Backend.Host;

internal sealed class JsonRpcServer {
	const int MaxHeaderLength = 8192;
	const int MaxMessageLength = 32 * 1024 * 1024;
	readonly Stream input;
	readonly Stream output;
	readonly WorkspaceManager workspaces;
	readonly CorDebugSessionManager? debugSessions;
	readonly HostOptions hostOptions;
	readonly CancellationTokenSource shutdown;
	readonly SemaphoreSlim outputGate = new(1, 1);
	readonly ConcurrentDictionary<string, CancellationTokenSource> requests = new(StringComparer.Ordinal);
	readonly JsonSerializerOptions jsonOptions = CreateJsonOptions();
	volatile bool handshakeComplete;

	public JsonRpcServer(Stream input, Stream output, WorkspaceManager workspaces, CorDebugSessionManager? debugSessions, HostOptions hostOptions, CancellationTokenSource shutdown) {
		this.input = input;
		this.output = output;
		this.workspaces = workspaces;
		this.debugSessions = debugSessions;
		this.hostOptions = hostOptions;
		this.shutdown = shutdown;
		if (debugSessions is not null)
			debugSessions.EventReceived += DebugSessions_EventReceived;
	}

	void DebugSessions_EventReceived(object? sender, DebugEventNotification e) =>
		_ = WriteNotificationAsync(RpcMethods.DebugEvent, e);

	static JsonSerializerOptions CreateJsonOptions() {
		var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) {
			PropertyNameCaseInsensitive = true,
		};
		options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
		return options;
	}

	public async Task RunAsync(CancellationToken cancellationToken) {
		HostLog.Info("backend-started", new {
			protocolVersion = ProtocolInfo.Version,
			processId = Environment.ProcessId,
		});
		var activeTasks = new HashSet<Task>();
		while (!cancellationToken.IsCancellationRequested) {
			var payload = await ReadFrameAsync(cancellationToken).ConfigureAwait(false);
			if (payload is null)
				break;

			RpcRequest? request;
			try {
				request = JsonSerializer.Deserialize<RpcRequest>(payload, jsonOptions);
				if (request is null || request.JsonRpc != "2.0" || string.IsNullOrWhiteSpace(request.Method))
					throw new JsonException("Invalid JSON-RPC request.");
			}
			catch (JsonException ex) {
				await WriteResponseAsync(new RpcResponse {
					Error = new RpcError(ErrorCodes.ParseError, "The JSON-RPC request could not be parsed."),
				}, CancellationToken.None).ConfigureAwait(false);
				HostLog.Error("request-parse-failed", ex);
				continue;
			}

			if (request.Method == RpcMethods.Cancel) {
				CancelRequest(request.Params);
				continue;
			}

			var task = ProcessRequestAsync(request, cancellationToken);
			lock (activeTasks)
				activeTasks.Add(task);
			_ = task.ContinueWith(
				completed => {
					lock (activeTasks)
						activeTasks.Remove(completed);
				},
				CancellationToken.None,
				TaskContinuationOptions.ExecuteSynchronously,
				TaskScheduler.Default);
		}

		Task[] remaining;
		lock (activeTasks)
			remaining = activeTasks.ToArray();
		await Task.WhenAll(remaining).ConfigureAwait(false);
		HostLog.Info("backend-stopped");
	}

	async Task ProcessRequestAsync(RpcRequest request, CancellationToken serverCancellationToken) {
		if (request.Id is null) {
			await ProcessNotificationAsync(request, serverCancellationToken).ConfigureAwait(false);
			return;
		}

		var requestKey = request.Id.Value.GetRawText();
		using var requestCancellation = CancellationTokenSource.CreateLinkedTokenSource(serverCancellationToken);
		if (!requests.TryAdd(requestKey, requestCancellation)) {
			await WriteErrorAsync(request.Id, ErrorCodes.InvalidRequest, "A request with this ID is already active.").ConfigureAwait(false);
			return;
		}

		try {
			var result = await DispatchAsync(request, requestCancellation.Token).ConfigureAwait(false);
			await WriteResponseAsync(new RpcResponse { Id = request.Id, Result = result }, CancellationToken.None).ConfigureAwait(false);
		}
		catch (OperationCanceledException) {
			await WriteErrorAsync(request.Id, ErrorCodes.RequestCanceled, "The request was canceled.").ConfigureAwait(false);
		}
		catch (RpcException ex) {
			await WriteResponseAsync(new RpcResponse {
				Id = request.Id,
				Error = new RpcError(ex.Code, ex.Message, ex.DataValue),
			}, CancellationToken.None).ConfigureAwait(false);
		}
		catch (JsonException ex) {
			await WriteErrorAsync(request.Id, ErrorCodes.InvalidParams, "The request parameters are invalid.").ConfigureAwait(false);
			HostLog.Error("invalid-request-params", ex);
		}
		catch (Exception ex) {
			await WriteErrorAsync(request.Id, ErrorCodes.InternalError, "The backend could not complete the request.").ConfigureAwait(false);
			HostLog.Error("request-failed", ex);
		}
		finally {
			requests.TryRemove(requestKey, out _);
		}
	}

	async Task ProcessNotificationAsync(RpcRequest request, CancellationToken cancellationToken) {
		try {
			await DispatchAsync(request, cancellationToken).ConfigureAwait(false);
		}
		catch (Exception ex) {
			HostLog.Error("notification-failed", ex);
		}
	}

	async Task<object?> DispatchAsync(RpcRequest request, CancellationToken cancellationToken) {
		if (!handshakeComplete && request.Method != RpcMethods.Hello)
			throw new RpcException(ErrorCodes.InvalidRequest, "system/hello must be the first request.");

		switch (request.Method) {
			case RpcMethods.Hello:
				return Hello(DeserializeParams<HelloRequest>(request));
			case RpcMethods.Shutdown:
				await shutdown.CancelAsync().ConfigureAwait(false);
				return new { acknowledged = true };
			case RpcMethods.WorkspaceOpen:
				return await workspaces.OpenAsync(DeserializeParams<OpenWorkspaceRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.WorkspaceClose:
				workspaces.Close(DeserializeParams<WorkspaceRequest>(request));
				return new { closed = true };
			case RpcMethods.TreeGetRoots:
				return await workspaces.GetRootsAsync(DeserializeParams<WorkspaceRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.TreeGetChildren:
				return await workspaces.GetChildrenAsync(DeserializeParams<NodeRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.TreeGetNode:
				return await workspaces.GetNodeAsync(DeserializeParams<NodeRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.DocumentDecompile:
				return await workspaces.DecompileAsync(DeserializeParams<DecompileRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.Search:
				return await workspaces.SearchAsync(DeserializeParams<SearchRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.AnalyzeReferences:
				return await workspaces.AnalyzeReferencesAsync(DeserializeParams<AnalyzeReferencesRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.HexGetLength:
				return await workspaces.GetHexLengthAsync(DeserializeParams<HexLengthRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.HexReadRange:
				return await workspaces.ReadHexAsync(DeserializeParams<HexReadRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.ModuleGetInfo:
				return await workspaces.GetModuleInfoAsync(DeserializeParams<ModuleInfoRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.EditBegin:
				return await workspaces.BeginEditAsync(DeserializeParams<BeginEditRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.EditGetMethodBody:
				return await workspaces.GetMethodBodyAsync(DeserializeParams<MethodBodyRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.EditRename:
				await workspaces.QueueRenameAsync(DeserializeParams<RenameEditRequest>(request), cancellationToken).ConfigureAwait(false);
				return new { queued = true };
			case RpcMethods.EditReplaceMethodBody:
				await workspaces.QueueMethodBodyAsync(DeserializeParams<ReplaceMethodBodyRequest>(request), cancellationToken).ConfigureAwait(false);
				return new { queued = true };
			case RpcMethods.EditReplaceResource:
				await workspaces.QueueResourceAsync(DeserializeParams<ReplaceResourceRequest>(request), cancellationToken).ConfigureAwait(false);
				return new { queued = true };
			case RpcMethods.EditCommit:
				return await workspaces.CommitEditAsync(DeserializeParams<EditTransactionRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.EditRollback:
				await workspaces.RollbackEditAsync(DeserializeParams<EditTransactionRequest>(request), cancellationToken).ConfigureAwait(false);
				return new { rolledBack = true };
			case RpcMethods.EditUndo:
				return await workspaces.UndoAsync(DeserializeParams<WorkspaceRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.EditRedo:
				return await workspaces.RedoAsync(DeserializeParams<WorkspaceRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.ModuleSaveAs:
				return await workspaces.SaveModuleAsync(DeserializeParams<SaveModuleRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.DebugLaunch:
				return await GetDebugSessions().LaunchAsync(DeserializeParams<DebugLaunchRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.DebugListProcesses:
				return GetDebugSessions().ListProcesses();
			case RpcMethods.DebugAttach:
				return await GetDebugSessions().AttachAsync(DeserializeParams<DebugAttachRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.DebugRequest:
				return await GetDebugSessions().RequestAsync(DeserializeParams<DebugAdapterRequest>(request), cancellationToken).ConfigureAwait(false);
			case RpcMethods.DebugDisconnect:
				await GetDebugSessions().DisconnectAsync(DeserializeParams<DebugDisconnectRequest>(request), cancellationToken).ConfigureAwait(false);
				return new { disconnected = true };
			default:
				throw new RpcException(ErrorCodes.MethodNotFound, $"Unknown method: {request.Method}");
		}
	}

	HelloResponse Hello(HelloRequest request) {
		if (request.ProtocolVersion != ProtocolInfo.Version)
			throw new RpcException(ErrorCodes.InvalidRequest, $"Protocol version {request.ProtocolVersion} is not supported.");
		if (hostOptions.Nonce is not null && !CryptographicEquals(request.Nonce, hostOptions.Nonce))
			throw new RpcException(ErrorCodes.InvalidRequest, "The backend handshake nonce is invalid.");
		handshakeComplete = true;
		return new HelloResponse(
			ProtocolInfo.Version,
			typeof(JsonRpcServer).Assembly.GetName().Version?.ToString() ?? "0.0.0",
			request.Nonce,
			RuntimeInformation.OSDescription,
			RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(),
			new Dictionary<string, bool>(StringComparer.Ordinal) {
				["workspace.open"] = true,
				["document.csharp"] = true,
				["document.visualBasic"] = true,
				["document.il"] = true,
				["document.ilWithCSharp"] = true,
				["search"] = true,
				["analyze.references"] = true,
				["hex.read"] = true,
				["assembly.edit"] = true,
				["assembly.edit.il"] = true,
				["assembly.edit.resources"] = true,
				["debug.coreclr.launch"] = debugSessions is not null,
				["debug.coreclr.attach"] = debugSessions is not null,
			});
	}

	CorDebugSessionManager GetDebugSessions() => debugSessions
		?? throw new RpcException(ErrorCodes.InvalidRequest, "The CoreCLR debug adapter is not installed.");

	T DeserializeParams<T>(RpcRequest request) {
		if (request.Params is null)
			throw new JsonException("The request does not contain params.");
		return request.Params.Value.Deserialize<T>(jsonOptions)
			?? throw new JsonException("The request params evaluated to null.");
	}

	void CancelRequest(JsonElement? parameters) {
		if (parameters is null || !parameters.Value.TryGetProperty("id", out var id))
			return;
		if (requests.TryGetValue(id.GetRawText(), out var cancellation))
			cancellation.Cancel();
	}

	async Task WriteErrorAsync(JsonElement? id, int code, string message) => await WriteResponseAsync(new RpcResponse {
		Id = id,
		Error = new RpcError(code, message),
	}, CancellationToken.None).ConfigureAwait(false);

	async Task WriteResponseAsync(RpcResponse response, CancellationToken cancellationToken) {
		var payload = JsonSerializer.SerializeToUtf8Bytes(response, jsonOptions);
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

	async Task WriteNotificationAsync(string method, object parameters) {
		try {
			var payload = JsonSerializer.SerializeToUtf8Bytes(new {
				jsonrpc = "2.0",
				method,
				@params = parameters,
			}, jsonOptions);
			var header = Encoding.ASCII.GetBytes($"Content-Length: {payload.Length}\r\n\r\n");
			await outputGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
			try {
				await output.WriteAsync(header).ConfigureAwait(false);
				await output.WriteAsync(payload).ConfigureAwait(false);
				await output.FlushAsync().ConfigureAwait(false);
			}
			finally {
				outputGate.Release();
			}
		}
		catch (Exception ex) {
			HostLog.Error("notification-write-failed", ex);
		}
	}

	async Task<byte[]?> ReadFrameAsync(CancellationToken cancellationToken) {
		var headerBuffer = new ArrayBufferWriter<byte>();
		var state = 0;
		while (headerBuffer.WrittenCount < MaxHeaderLength) {
			var oneByte = new byte[1];
			var bytesRead = await input.ReadAsync(oneByte, cancellationToken).ConfigureAwait(false);
			if (bytesRead == 0)
				return headerBuffer.WrittenCount == 0 ? null : throw new EndOfStreamException("The JSON-RPC header ended unexpectedly.");
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
			throw new RpcException(ErrorCodes.InvalidRequest, "The JSON-RPC header is too large.");

		var header = Encoding.ASCII.GetString(headerBuffer.WrittenSpan);
		var contentLength = ParseContentLength(header);
		if (contentLength < 0 || contentLength > MaxMessageLength)
			throw new RpcException(ErrorCodes.InvalidRequest, $"Content-Length must be between 0 and {MaxMessageLength} bytes.");
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
			if (separator < 0 || !line[..separator].Trim().Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
				continue;
			if (int.TryParse(line[(separator + 1)..].Trim(), out var length))
				return length;
		}
		throw new RpcException(ErrorCodes.InvalidRequest, "The JSON-RPC frame has no valid Content-Length header.");
	}

	static bool CryptographicEquals(string left, string right) {
		var leftBytes = Encoding.UTF8.GetBytes(left);
		var rightBytes = Encoding.UTF8.GetBytes(right);
		return leftBytes.Length == rightBytes.Length && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
	}
}
