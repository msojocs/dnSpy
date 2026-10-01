using System.Collections.Concurrent;
using System.Globalization;
using System.Reflection;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Resources;
using System.Security.Cryptography;
using System.Text;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using dnSpy.Backend.Contracts;
using ICSharpCode.Decompiler;
using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.CSharp.OutputVisitor;
using ICSharpCode.Decompiler.Disassembler;
using ICSharpCode.CodeConverter;
using ICSharpCode.BamlDecompiler;
using DecompilerIMember = ICSharpCode.Decompiler.TypeSystem.IMember;
using DecompilerIType = ICSharpCode.Decompiler.TypeSystem.IType;
using DecompilerMetadataFile = ICSharpCode.Decompiler.Metadata.MetadataFile;

namespace dnSpy.Backend.Core;

public sealed class WorkspaceManager : IDisposable {
	const int MaxHexReadLength = 1024 * 1024;
	readonly ConcurrentDictionary<string, Workspace> workspaces = new(StringComparer.Ordinal);
	bool disposed;

	public async Task<OpenWorkspaceResponse> OpenAsync(OpenWorkspaceRequest request, CancellationToken cancellationToken) {
		ObjectDisposedException.ThrowIf(disposed, this);
		if (request.Paths.Count == 0)
			throw new RpcException(ErrorCodes.InvalidParams, "At least one path is required.");

		var paths = ExpandPaths(request.Paths);
		if (paths.Count == 0)
			throw new RpcException(ErrorCodes.FileNotFound, "No managed assemblies were found in the selected paths.");

		var workspace = new Workspace();
		try {
			await workspace.OpenAsync(paths, cancellationToken).ConfigureAwait(false);
			if (!workspaces.TryAdd(workspace.Id, workspace))
				throw new InvalidOperationException("Could not register the workspace.");
			return workspace.CreateOpenResponse();
		}
		catch {
			workspace.Dispose();
			throw;
		}
	}

	public void Close(WorkspaceRequest request) {
		if (workspaces.TryRemove(request.WorkspaceId, out var workspace))
			workspace.Dispose();
	}

	public Task<TreeNodesResponse> GetRootsAsync(WorkspaceRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.GetRoots(), cancellationToken);

	public Task<TreeNodesResponse> GetChildrenAsync(NodeRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.GetChildren(request.NodeId), cancellationToken);

	public Task<TreeNodeDto> GetNodeAsync(NodeRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.GetNodeDto(request.NodeId), cancellationToken);

	public Task<DecompileResponse> DecompileAsync(DecompileRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.DecompileAsync(request, cancellationToken), cancellationToken);

	public Task<SearchResponse> SearchAsync(SearchRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.Search(request, cancellationToken), cancellationToken);

	public Task<AnalyzeReferencesResponse> AnalyzeReferencesAsync(AnalyzeReferencesRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.AnalyzeReferences(request, cancellationToken), cancellationToken);

	public Task<HexLengthResponse> GetHexLengthAsync(HexLengthRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.GetHexLength(request.ModuleId), cancellationToken);

	public async Task<HexReadResponse> ReadHexAsync(HexReadRequest request, CancellationToken cancellationToken) {
		if (request.Offset < 0 || request.Count < 0)
			throw new RpcException(ErrorCodes.InvalidParams, "Offset and count must not be negative.");
		if (request.Count > MaxHexReadLength)
			throw new RpcException(ErrorCodes.RangeTooLarge, $"A hex read is limited to {MaxHexReadLength} bytes.");
		return await GetWorkspace(request.WorkspaceId).RunAsync(
			w => w.ReadHexAsync(request.ModuleId, request.Offset, request.Count, cancellationToken),
			cancellationToken).ConfigureAwait(false);
	}

	public Task<ModuleInfoResponse> GetModuleInfoAsync(ModuleInfoRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.GetModuleInfo(request.ModuleId), cancellationToken);

	public Task<BeginEditResponse> BeginEditAsync(BeginEditRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.BeginEdit(), cancellationToken);

	public Task<MethodBodyResponse> GetMethodBodyAsync(MethodBodyRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.GetMethodBody(request.MethodNodeId), cancellationToken);

	public Task QueueRenameAsync(RenameEditRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => {
			w.QueueRename(request);
			return true;
		}, cancellationToken);

	public Task QueueMethodBodyAsync(ReplaceMethodBodyRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => {
			w.QueueMethodBody(request);
			return true;
		}, cancellationToken);

	public Task QueueResourceAsync(ReplaceResourceRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => {
			w.QueueResource(request);
			return true;
		}, cancellationToken);

	public Task<EditCommitResponse> CommitEditAsync(EditTransactionRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.CommitEdit(request.TransactionId), cancellationToken);

	public Task RollbackEditAsync(EditTransactionRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => {
			w.RollbackEdit(request.TransactionId);
			return true;
		}, cancellationToken);

	public Task<EditCommitResponse> UndoAsync(WorkspaceRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.Undo(), cancellationToken);

	public Task<EditCommitResponse> RedoAsync(WorkspaceRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.Redo(), cancellationToken);

	public Task<SaveModuleResponse> SaveModuleAsync(SaveModuleRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.SaveModuleAsync(request, cancellationToken), cancellationToken);

	Workspace GetWorkspace(string id) => workspaces.TryGetValue(id, out var workspace)
		? workspace
		: throw new RpcException(ErrorCodes.WorkspaceNotFound, "The workspace no longer exists.");

	static IReadOnlyList<string> ExpandPaths(IReadOnlyList<string> requestedPaths) {
		var paths = new HashSet<string>(StringComparer.Ordinal);
		foreach (var requestedPath in requestedPaths) {
			if (string.IsNullOrWhiteSpace(requestedPath))
				continue;
			var path = Path.GetFullPath(requestedPath);
			if (File.Exists(path)) {
				paths.Add(path);
				continue;
			}
			if (Directory.Exists(path)) {
				foreach (var candidate in Directory.EnumerateFiles(path, "*", SearchOption.TopDirectoryOnly)) {
					var extension = Path.GetExtension(candidate);
					if (extension.Equals(".dll", StringComparison.OrdinalIgnoreCase) ||
						extension.Equals(".exe", StringComparison.OrdinalIgnoreCase) ||
						extension.Equals(".netmodule", StringComparison.OrdinalIgnoreCase) ||
						extension.Equals(".winmd", StringComparison.OrdinalIgnoreCase))
						paths.Add(Path.GetFullPath(candidate));
				}
				continue;
			}
			throw new RpcException(ErrorCodes.FileNotFound, $"Path does not exist: {path}");
		}
		return paths.Order(StringComparer.Ordinal).ToArray();
	}

	public void Dispose() {
		if (disposed)
			return;
		disposed = true;
		foreach (var workspace in workspaces.Values)
			workspace.Dispose();
		workspaces.Clear();
	}

	sealed class Workspace : IDisposable {
		readonly SemaphoreSlim gate = new(1, 1);
		readonly Dictionary<string, ModuleEntry> modules = new(StringComparer.Ordinal);
		readonly Dictionary<string, NodeEntry> nodes = new(StringComparer.Ordinal);
		readonly Dictionary<string, string> nodeIdsByKey = new(StringComparer.Ordinal);
		readonly Dictionary<string, EditTransaction> transactions = new(StringComparer.Ordinal);
		readonly Stack<EditHistoryEntry> undoHistory = new();
		readonly Stack<EditHistoryEntry> redoHistory = new();
		int nextNodeId;
		int version;
		string stateId = Guid.NewGuid().ToString("N");
		bool disposed;

		public Workspace() => Id = Guid.NewGuid().ToString("N");

		public string Id { get; }

		public async Task OpenAsync(IReadOnlyList<string> paths, CancellationToken cancellationToken) {
			foreach (var path in paths) {
				cancellationToken.ThrowIfCancellationRequested();
				ModuleDefMD module;
				try {
					module = await Task.Run(() => ModuleDefMD.Load(path), cancellationToken).ConfigureAwait(false);
				}
				catch (BadImageFormatException) when (paths.Count > 1) {
					continue;
				}
				var entry = new ModuleEntry(path, module);
				var root = GetOrAddNode($"module:{path}", NodeKind.Module, module, entry);
				entry.Id = root.Id;
				modules.Add(entry.Id, entry);
			}
			if (modules.Count == 0)
				throw new RpcException(ErrorCodes.InvalidParams, "None of the selected files is a managed assembly.");
		}

		public OpenWorkspaceResponse CreateOpenResponse() => new(
			Id,
			modules.Values.Select(m => new OpenedModule(
				m.Id,
				m.Module.Assembly?.Name.String ?? m.Module.Name.String,
				m.Path,
				File.Exists(Path.ChangeExtension(m.Path, ".pdb")))).ToArray(),
			stateId);

		public TreeNodesResponse GetRoots() => new(modules.Values.Select(m => ToDto(nodes[m.Id])).ToArray());

		public TreeNodesResponse GetChildren(string nodeId) {
			var node = GetNode(nodeId);
			var children = node.Kind switch {
				NodeKind.Module => GetModuleChildren(node),
				NodeKind.Namespace => GetNamespaceChildren(node),
				NodeKind.ReferencesGroup => GetReferenceChildren(node),
				NodeKind.ResourcesGroup => GetResourceChildren(node),
				NodeKind.Resource => GetEmbeddedResourceChildren(node),
				NodeKind.Type => GetTypeChildren(node),
				_ => Array.Empty<NodeEntry>(),
			};
			return new TreeNodesResponse(children.Select(ToDto).ToArray());
		}

		public TreeNodeDto GetNodeDto(string nodeId) => ToDto(GetNode(nodeId));

		IReadOnlyList<NodeEntry> GetModuleChildren(NodeEntry node) {
			var module = (ModuleDefMD)node.Value;
			var result = new List<NodeEntry>();
			if (module.GetAssemblyRefs().Any())
				result.Add(GetOrAddNode($"{node.Key}:references", NodeKind.ReferencesGroup, module, node.Module));
			if (module.Resources.Count != 0)
				result.Add(GetOrAddNode($"{node.Key}:resources", NodeKind.ResourcesGroup, module, node.Module));

			foreach (var group in module.Types
				.Where(t => t.DeclaringType is null && !t.IsGlobalModuleType)
				.GroupBy(t => t.Namespace.String ?? string.Empty, StringComparer.Ordinal)
				.OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase)) {
				result.Add(GetOrAddNode(
					$"{node.Key}:namespace:{group.Key}",
					NodeKind.Namespace,
					new NamespaceValue(group.Key, group.ToArray()),
					node.Module));
			}
			return result;
		}

		IReadOnlyList<NodeEntry> GetNamespaceChildren(NodeEntry node) {
			var value = (NamespaceValue)node.Value;
			return value.Types
				.OrderBy(t => t.Name.String, StringComparer.OrdinalIgnoreCase)
				.Select(t => GetMemberNode(t, node.Module))
				.ToArray();
		}

		IReadOnlyList<NodeEntry> GetReferenceChildren(NodeEntry node) => ((ModuleDefMD)node.Value)
			.GetAssemblyRefs()
			.OrderBy(r => r.Name.String, StringComparer.OrdinalIgnoreCase)
			.Select(r => GetOrAddNode(MemberKey(node.Module, "reference", r.MDToken.Raw), NodeKind.AssemblyReference, r, node.Module))
			.ToArray();

		IReadOnlyList<NodeEntry> GetResourceChildren(NodeEntry node) => ((ModuleDefMD)node.Value)
			.Resources
			.OrderBy(r => r.Name.String, StringComparer.OrdinalIgnoreCase)
			.Select((r, index) => GetOrAddNode($"resource:{node.Module.Id}:{index}:{r.Name}", NodeKind.Resource, r, node.Module))
			.ToArray();

		IReadOnlyList<NodeEntry> GetEmbeddedResourceChildren(NodeEntry node) {
			if (node.Value is not EmbeddedResource embedded || !embedded.Name.EndsWith(".resources", StringComparison.OrdinalIgnoreCase))
				return Array.Empty<NodeEntry>();
			var values = new List<ResourceEntryValue>();
			using var stream = embedded.CreateReader().AsStream();
			using var reader = new ResourceReader(stream);
			var enumerator = reader.GetEnumerator();
			while (enumerator.MoveNext()) {
				var name = enumerator.Key?.ToString() ?? string.Empty;
				reader.GetResourceData(name, out var typeName, out var data);
				values.Add(new ResourceEntryValue(name, DecodeResourceData(typeName, data), typeName));
			}
			return values
				.OrderBy(value => value.Name, StringComparer.OrdinalIgnoreCase)
				.Select(value => GetOrAddNode($"resource-entry:{node.Module.Id}:{embedded.Name}:{value.Name}", NodeKind.ResourceEntry, value, node.Module))
				.ToArray();
		}

		static object? DecodeResourceData(string typeName, byte[] data) {
			if (typeName == "ResourceTypeCode.Null")
				return null;
			using var stream = new MemoryStream(data, writable: false);
			using var reader = new BinaryReader(stream, Encoding.UTF8, leaveOpen: false);
			if (typeName == "ResourceTypeCode.String")
				return reader.ReadString();
			if (typeName is "ResourceTypeCode.ByteArray" or "ResourceTypeCode.Stream") {
				var length = reader.ReadInt32();
				if (length < 0 || length > stream.Length - stream.Position)
					throw new BadImageFormatException($"Resource entry has an invalid byte length: {length}");
				return reader.ReadBytes(length);
			}
			return data;
		}

		IReadOnlyList<NodeEntry> GetTypeChildren(NodeEntry node) {
			var type = (TypeDef)node.Value;
			var result = new List<NodeEntry>();
			result.AddRange(type.NestedTypes.OrderBy(t => t.Name.String, StringComparer.OrdinalIgnoreCase).Select(t => GetMemberNode(t, node.Module)));
			result.AddRange(type.Fields.OrderBy(f => f.Name.String, StringComparer.OrdinalIgnoreCase).Select(f => GetMemberNode(f, node.Module)));
			result.AddRange(type.Properties.OrderBy(p => p.Name.String, StringComparer.OrdinalIgnoreCase).Select(p => GetMemberNode(p, node.Module)));
			result.AddRange(type.Events.OrderBy(e => e.Name.String, StringComparer.OrdinalIgnoreCase).Select(e => GetMemberNode(e, node.Module)));
			result.AddRange(type.Methods.OrderBy(m => m.Name.String, StringComparer.OrdinalIgnoreCase).ThenBy(m => m.MethodSig?.Params.Count ?? 0).Select(m => GetMemberNode(m, node.Module)));
			return result;
		}

		public async Task<DecompileResponse> DecompileAsync(DecompileRequest request, CancellationToken cancellationToken) {
			var node = GetNode(request.NodeId);
			cancellationToken.ThrowIfCancellationRequested();
			if (node.Kind == NodeKind.ResourceEntry)
				return DecompileResourceEntry(node, cancellationToken);
			return request.Language switch {
				DecompilerLanguage.CSharp => DecompileCSharp(node, cancellationToken),
				DecompilerLanguage.IL => DecompileIL(node),
				DecompilerLanguage.VisualBasic => await DecompileVisualBasicAsync(node, cancellationToken).ConfigureAwait(false),
				_ => throw new RpcException(ErrorCodes.InvalidParams, "Unknown decompiler language."),
			};
		}

		DecompileResponse DecompileResourceEntry(NodeEntry node, CancellationToken cancellationToken) {
			var resource = (ResourceEntryValue)node.Value;
			if (resource.Name.EndsWith(".baml", StringComparison.OrdinalIgnoreCase) && resource.Value is byte[] baml) {
				try {
					var decompiler = new XamlDecompiler(node.Module.Path, new BamlDecompilerSettings {
						ThrowOnAssemblyResolveErrors = false,
					}) {
						CancellationToken = cancellationToken,
					};
					using var stream = new MemoryStream(baml, writable: false);
					var result = decompiler.Decompile(stream);
					return new DecompileResponse(resource.Name, "xml", result.Xaml.ToString(), Array.Empty<TextSpanDto>(), Array.Empty<DiagnosticDto>());
				}
				catch (Exception ex) when (ex is not OperationCanceledException) {
					return new DecompileResponse(resource.Name, "xml", string.Empty, Array.Empty<TextSpanDto>(), [new DiagnosticDto("error", ex.Message)]);
				}
			}
			if (resource.Value is string text)
				return new DecompileResponse(resource.Name, GuessResourceLanguage(resource.Name), text, Array.Empty<TextSpanDto>(), Array.Empty<DiagnosticDto>());
			if (resource.Value is byte[] bytes)
				return new DecompileResponse(resource.Name, "plaintext", Convert.ToHexString(bytes), Array.Empty<TextSpanDto>(), [new DiagnosticDto("info", $"Binary resource, {bytes.Length:N0} bytes")]);
			return new DecompileResponse(resource.Name, "plaintext", resource.Value?.ToString() ?? string.Empty, Array.Empty<TextSpanDto>(), Array.Empty<DiagnosticDto>());
		}

		static string GuessResourceLanguage(string name) => Path.GetExtension(name).ToLowerInvariant() switch {
			".xaml" or ".xml" => "xml",
			".json" => "json",
			".cs" => "csharp",
			".vb" => "visual-basic",
			_ => "plaintext",
		};

		DecompileResponse DecompileCSharp(NodeEntry node, CancellationToken cancellationToken) {
			var settings = new DecompilerSettings();
			MemoryStream? snapshotStream = null;
			ICSharpCode.Decompiler.Metadata.PEFile? snapshotFile = null;
			try {
				CSharpDecompiler decompiler;
				if (node.Module.IsModified) {
					snapshotStream = new MemoryStream();
					node.Module.Module.Write(snapshotStream);
					snapshotStream.Position = 0;
					snapshotFile = new ICSharpCode.Decompiler.Metadata.PEFile(
						node.Module.Path,
						snapshotStream,
						PEStreamOptions.PrefetchEntireImage);
					var resolver = new ICSharpCode.Decompiler.Metadata.UniversalAssemblyResolver(
						node.Module.Path,
						throwOnError: false,
						targetFramework: ICSharpCode.Decompiler.Metadata.DotNetCorePathFinderExtensions.DetectTargetFrameworkId(snapshotFile),
						runtimePack: ICSharpCode.Decompiler.Metadata.DotNetCorePathFinderExtensions.DetectRuntimePack(snapshotFile));
					decompiler = new CSharpDecompiler(snapshotFile, resolver, settings);
				}
				else
					decompiler = new CSharpDecompiler(node.Module.Path, settings);
				decompiler.CancellationToken = cancellationToken;

				string text;
				IReadOnlyList<TextSpanDto> spans = Array.Empty<TextSpanDto>();
				if (node.Kind == NodeKind.AssemblyReference)
					text = ((AssemblyRef)node.Value).FullName;
				else if (node.Kind == NodeKind.Resource)
					text = DescribeResource((Resource)node.Value);
				else {
					var syntaxTree = node.Kind switch {
						NodeKind.Module => decompiler.DecompileWholeModuleAsSingleFile(),
						NodeKind.Namespace => decompiler.Decompile(((NamespaceValue)node.Value).Types.Select(ToEntityHandle)),
						NodeKind.Type or NodeKind.Method or NodeKind.Field or NodeKind.Property or NodeKind.Event =>
							decompiler.Decompile([ToEntityHandle((IMDTokenProvider)node.Value)]),
						_ => throw new RpcException(ErrorCodes.UnsupportedDocument, "This tree node cannot be decompiled."),
					};
					var output = new SpanTextOutput(reference => ResolveDecompilerReference(reference, node.Module));
					syntaxTree.AcceptVisitor(new CSharpOutputVisitor(new TextTokenWriter(output, settings), settings.CSharpFormattingOptions));
					text = output.ToString();
					spans = output.Spans;
				}
				var diagnostics = decompiler.Errors
					.Select(e => new DiagnosticDto("warning", e.ToString()))
					.ToArray();
				return new DecompileResponse(GetLabel(node), "csharp", text, spans, diagnostics);
			}
			catch (OperationCanceledException) {
				throw;
			}
			catch (Exception ex) {
				throw new RpcException(ErrorCodes.UnsupportedDocument, "The selected item could not be decompiled.", null, ex);
			}
			finally {
				snapshotFile?.Dispose();
				snapshotStream?.Dispose();
			}
		}

		string? ResolveDecompilerReference(object reference, ModuleEntry defaultModule) {
			if (reference is MetadataReference metadataReference)
				return ResolveMetadataHandle(metadataReference.Metadata, metadataReference.Handle, defaultModule);
			System.Reflection.Metadata.EntityHandle handle;
			DecompilerMetadataFile? metadataFile;
			switch (reference) {
				case DecompilerIMember member:
					handle = member.MetadataToken;
					metadataFile = member.ParentModule?.MetadataFile;
					break;
				case DecompilerIType type when type.GetDefinition() is { } definition:
					handle = definition.MetadataToken;
					metadataFile = definition.ParentModule?.MetadataFile;
					break;
				default:
					return null;
			}
			return ResolveMetadataHandle(metadataFile, handle, defaultModule);
		}

		string? ResolveMetadataHandle(DecompilerMetadataFile? metadataFile, System.Reflection.Metadata.Handle handle, ModuleEntry defaultModule) {
			if (handle.IsNil)
				return null;
			var module = defaultModule;
			if (!string.IsNullOrEmpty(metadataFile?.FileName)) {
				var matchingModule = modules.Values.FirstOrDefault(candidate => Path.GetFullPath(candidate.Path).Equals(Path.GetFullPath(metadataFile.FileName), StringComparison.Ordinal));
				if (matchingModule is not null)
					module = matchingModule;
			}
			var token = unchecked((uint)MetadataTokens.GetToken(handle));
			if (module.Module.ResolveToken(token) is not IMDTokenProvider provider || provider is not (TypeDef or MethodDef or FieldDef or PropertyDef or EventDef))
				return null;
			return GetMemberNode(provider, module).Id;
		}

		static System.Reflection.Metadata.EntityHandle ToEntityHandle(IMDTokenProvider provider) =>
			MetadataTokens.EntityHandle(unchecked((int)provider.MDToken.Raw));

		DecompileResponse DecompileIL(NodeEntry node) => new(
			GetLabel(node),
			"il",
			ILFormatter.Format(node),
			Array.Empty<TextSpanDto>(),
			Array.Empty<DiagnosticDto>());

		async Task<DecompileResponse> DecompileVisualBasicAsync(NodeEntry node, CancellationToken cancellationToken) {
			var csharp = DecompileCSharp(node, cancellationToken);
			var conversion = await CodeConverter.ConvertAsync(
				new CodeWithOptions(csharp.Text).WithTypeReferences(),
				cancellationToken).ConfigureAwait(false);
			if (!conversion.Success) {
				var message = conversion.GetExceptionsAsString();
				return new DecompileResponse(
					csharp.Title,
					"visual-basic",
					$"' Visual Basic conversion failed.\n' {message.Replace(Environment.NewLine, Environment.NewLine + "' ", StringComparison.Ordinal)}",
					Array.Empty<TextSpanDto>(),
					[new DiagnosticDto("error", message)]);
			}
			var diagnostics = csharp.Diagnostics
				.Concat(conversion.Exceptions?.Select(exception => new DiagnosticDto("warning", exception)) ?? [])
				.ToArray();
			return new DecompileResponse(csharp.Title, "visual-basic", conversion.ConvertedCode, Array.Empty<TextSpanDto>(), diagnostics);
		}

		public SearchResponse Search(SearchRequest request, CancellationToken cancellationToken) {
			if (string.IsNullOrWhiteSpace(request.Query))
				return new SearchResponse(Array.Empty<SearchResultDto>(), false);
			var maxResults = Math.Clamp(request.MaxResults, 1, 10_000);
			var comparison = request.MatchCase ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;
			var requestedKinds = request.Kinds is null ? null : new HashSet<string>(request.Kinds, StringComparer.OrdinalIgnoreCase);
			var results = new List<SearchResultDto>();

			bool Add(NodeEntry node, string kind, string name, string location, string? preview = null) {
				if (requestedKinds is not null && !requestedKinds.Contains(kind))
					return false;
				if (!name.Contains(request.Query, comparison) && (preview is null || !preview.Contains(request.Query, comparison)))
					return false;
				results.Add(new SearchResultDto(node.Id, kind, name, location, preview));
				return results.Count >= maxResults;
			}

			foreach (var moduleEntry in modules.Values) {
				foreach (var type in moduleEntry.Module.GetTypes()) {
					cancellationToken.ThrowIfCancellationRequested();
					var typeNode = GetMemberNode(type, moduleEntry);
					if (Add(typeNode, "type", type.FullName, moduleEntry.Module.Name.String))
						return new SearchResponse(results, true);
					foreach (var member in EnumerateMembers(type)) {
						var memberNode = GetMemberNode(member, moduleEntry);
						if (Add(memberNode, GetKind(member).ToString().ToLowerInvariant(), GetMemberDisplayName(member), type.FullName))
							return new SearchResponse(results, true);
					}
					foreach (var method in type.Methods.Where(m => m.HasBody)) {
						foreach (var instruction in method.Body.Instructions) {
							if (instruction.Operand is not string value)
								continue;
							var methodNode = GetMemberNode(method, moduleEntry);
							if (Add(methodNode, "string", value, method.FullName, value))
								return new SearchResponse(results, true);
						}
					}
				}
			}
			return new SearchResponse(results, false);
		}

		public AnalyzeReferencesResponse AnalyzeReferences(AnalyzeReferencesRequest request, CancellationToken cancellationToken) {
			var target = GetNode(request.NodeId);
			var targetName = GetReferenceIdentity(target.Value);
			if (targetName is null)
				throw new RpcException(ErrorCodes.InvalidParams, "References can only be analyzed for types and members.");
			var maxResults = Math.Clamp(request.MaxResults, 1, 10_000);
			var results = new List<ReferenceResultDto>();

			foreach (var module in modules.Values) {
				foreach (var type in module.Module.GetTypes()) {
					cancellationToken.ThrowIfCancellationRequested();
					if (type.BaseType is not null && GetReferenceIdentity(type.BaseType) == targetName) {
						var source = GetMemberNode(type, module);
						results.Add(new ReferenceResultDto(source.Id, type.FullName, "base-type", module.Module.Name.String));
					}
					foreach (var method in type.Methods.Where(m => m.HasBody)) {
						foreach (var instruction in method.Body.Instructions) {
							if (!ReferencesTarget(instruction.Operand, targetName))
								continue;
							var source = GetMemberNode(method, module);
							results.Add(new ReferenceResultDto(source.Id, method.FullName, "instruction", $"IL_{instruction.Offset:X4}"));
							if (results.Count >= maxResults)
								return new AnalyzeReferencesResponse(results, true);
						}
					}
				}
			}
			return new AnalyzeReferencesResponse(results, false);
		}

		public HexLengthResponse GetHexLength(string moduleId) => new(GetModule(moduleId).FileLength);

		public async Task<HexReadResponse> ReadHexAsync(string moduleId, long offset, int count, CancellationToken cancellationToken) {
			var module = GetModule(moduleId);
			if (offset > module.FileLength)
				throw new RpcException(ErrorCodes.InvalidParams, "Offset is beyond the end of the file.");
			var actualCount = (int)Math.Min(count, module.FileLength - offset);
			var buffer = new byte[actualCount];
			await using var stream = new FileStream(module.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 64 * 1024, FileOptions.Asynchronous | FileOptions.RandomAccess);
			stream.Position = offset;
			await stream.ReadExactlyAsync(buffer, cancellationToken).ConfigureAwait(false);
			return new HexReadResponse(offset, Convert.ToBase64String(buffer), offset + actualCount >= module.FileLength);
		}

		public ModuleInfoResponse GetModuleInfo(string moduleId) {
			var entry = GetModule(moduleId);
			var module = entry.Module;
			var (peHeaders, metadataTables) = ReadPortableExecutableInfo(entry.Path);
			return new ModuleInfoResponse(
				module.Assembly?.FullName ?? module.Name.String,
				entry.Path,
				module.RuntimeVersion ?? string.Empty,
				module.Machine.ToString(),
				module.Kind.ToString(),
				module.Mvid ?? Guid.Empty,
				module.EntryPoint?.FullName,
				module.GetTypes().Count(),
				module.Resources.Count,
				module.GetAssemblyRefs().Select(a => a.FullName).ToArray(),
				peHeaders,
				metadataTables);
		}

		static (IReadOnlyDictionary<string, string> PeHeaders, IReadOnlyDictionary<string, int> MetadataTables) ReadPortableExecutableInfo(string path) {
			using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
			using var peReader = new PEReader(stream, PEStreamOptions.PrefetchMetadata);
			var headers = peReader.PEHeaders;
			var peHeader = headers.PEHeader;
			var peValues = new Dictionary<string, string>(StringComparer.Ordinal) {
				["Machine"] = headers.CoffHeader.Machine.ToString(),
				["Characteristics"] = headers.CoffHeader.Characteristics.ToString(),
				["Sections"] = headers.SectionHeaders.Length.ToString(CultureInfo.InvariantCulture),
				["PE magic"] = peHeader?.Magic.ToString() ?? string.Empty,
				["Subsystem"] = peHeader?.Subsystem.ToString() ?? string.Empty,
				["Image base"] = peHeader is null ? string.Empty : $"0x{peHeader.ImageBase:X}",
				["Entry point RVA"] = peHeader is null ? string.Empty : $"0x{peHeader.AddressOfEntryPoint:X8}",
				["Cor flags"] = headers.CorHeader?.Flags.ToString() ?? string.Empty,
			};
			var tableValues = new Dictionary<string, int>(StringComparer.Ordinal);
			if (peReader.HasMetadata) {
				var metadata = System.Reflection.Metadata.PEReaderExtensions.GetMetadataReader(peReader);
				foreach (var table in Enum.GetValues<TableIndex>()) {
					var count = metadata.GetTableRowCount(table);
					if (count > 0)
						tableValues[table.ToString()] = count;
				}
			}
			return (peValues, tableValues);
		}

		public BeginEditResponse BeginEdit() {
			var transaction = new EditTransaction(version);
			transactions.Add(transaction.Id, transaction);
			return new BeginEditResponse(transaction.Id, transaction.BaseVersion);
		}

		public MethodBodyResponse GetMethodBody(string methodNodeId) {
			var node = GetNode(methodNodeId);
			if (node.Value is not MethodDef method || !method.HasBody)
				throw new RpcException(ErrorCodes.EditValidationFailed, "The selected method has no managed IL body.");
			var labels = method.Body.Instructions.ToDictionary(instruction => instruction, instruction => $"IL_{instruction.Offset:X4}");
			var instructions = method.Body.Instructions.Select(instruction => SerializeInstruction(method, instruction, labels)).ToArray();
			return new MethodBodyResponse(
				method.Body.MaxStack,
				method.Body.InitLocals,
				method.Body.Variables.Select(local => local.Type.FullName).ToArray(),
				instructions,
				method.Body.ExceptionHandlers.Count > 0);
		}

		IlInstructionDto SerializeInstruction(MethodDef method, Instruction instruction, IReadOnlyDictionary<Instruction, string> labels) {
			var label = labels[instruction];
			return instruction.Operand switch {
				null => new IlInstructionDto(label, instruction.OpCode.Name),
				string text => new IlInstructionDto(label, instruction.OpCode.Name, "string", text, text),
				Instruction target => new IlInstructionDto(label, instruction.OpCode.Name, "branch", labels[target], labels[target]),
				IList<Instruction> targets => new IlInstructionDto(label, instruction.OpCode.Name, "switch", string.Join(',', targets.Select(target => labels[target])), string.Join(", ", targets.Select(target => labels[target]))),
				Local local => new IlInstructionDto(label, instruction.OpCode.Name, "local", local.Index.ToString(CultureInfo.InvariantCulture), $"V_{local.Index}"),
				Parameter parameter => new IlInstructionDto(label, instruction.OpCode.Name, "argument", method.Parameters.IndexOf(parameter).ToString(CultureInfo.InvariantCulture), parameter.Name ?? $"A_{parameter.Index}"),
				IMDTokenProvider token => new IlInstructionDto(label, instruction.OpCode.Name, "token", token.MDToken.Raw.ToString("X8", CultureInfo.InvariantCulture), token.ToString()),
				float value => new IlInstructionDto(label, instruction.OpCode.Name, "number", value.ToString("R", CultureInfo.InvariantCulture)),
				double value => new IlInstructionDto(label, instruction.OpCode.Name, "number", value.ToString("R", CultureInfo.InvariantCulture)),
				IFormattable value => new IlInstructionDto(label, instruction.OpCode.Name, "number", value.ToString(null, CultureInfo.InvariantCulture)),
				_ => throw new RpcException(ErrorCodes.EditValidationFailed, $"Operand type {instruction.Operand.GetType().Name} cannot be edited."),
			};
		}

		public void QueueRename(RenameEditRequest request) {
			if (string.IsNullOrWhiteSpace(request.NewName) || request.NewName.Contains('\0'))
				throw new RpcException(ErrorCodes.EditValidationFailed, "The new name is invalid.");
			var transaction = GetTransaction(request.TransactionId);
			var node = GetNode(request.NodeId);
			if (node.Value is not IMDTokenProvider)
				throw new RpcException(ErrorCodes.EditValidationFailed, "Only types and members can be renamed.");
			var oldName = GetEditableName(node.Value)
				?? throw new RpcException(ErrorCodes.EditValidationFailed, "The selected item cannot be renamed.");
			transaction.Add(node.Id, node.Module, () => {
				SetEditableName(node.Value, request.NewName);
				return () => SetEditableName(node.Value, oldName);
			});
		}

		public void QueueMethodBody(ReplaceMethodBodyRequest request) {
			var transaction = GetTransaction(request.TransactionId);
			var node = GetNode(request.MethodNodeId);
			if (node.Value is not MethodDef method)
				throw new RpcException(ErrorCodes.EditValidationFailed, "The selected item is not a method.");
			if (method.HasBody && method.Body.ExceptionHandlers.Count > 0 && !request.ClearExceptionHandlers)
				throw new RpcException(ErrorCodes.EditValidationFailed, "The method contains exception handlers. Explicitly clear them or use an exception-handler aware editor.");

			var body = BuildMethodBody(method, request);
			transaction.Add(node.Id, node.Module, () => {
				var oldBody = method.Body;
				method.Body = body;
				return () => method.Body = oldBody;
			});
		}

		public void QueueResource(ReplaceResourceRequest request) {
			var transaction = GetTransaction(request.TransactionId);
			var node = GetNode(request.ResourceNodeId);
			if (node.Value is not EmbeddedResource oldResource)
				throw new RpcException(ErrorCodes.EditValidationFailed, "Only embedded resources can be replaced.");
			byte[] data;
			try {
				data = Convert.FromBase64String(request.Base64Data);
			}
			catch (FormatException ex) {
				throw new RpcException(ErrorCodes.EditValidationFailed, "The resource data is not valid base64.", null, ex);
			}
			var index = node.Module.Module.Resources.IndexOf(oldResource);
			if (index < 0)
				throw new RpcException(ErrorCodes.EditValidationFailed, "The resource no longer belongs to the module.");
			var replacement = new EmbeddedResource(oldResource.Name, data, oldResource.Attributes);
			transaction.Add(node.Id, node.Module, () => {
				node.Module.Module.Resources[index] = replacement;
				node.Value = replacement;
				return () => {
					node.Module.Module.Resources[index] = oldResource;
					node.Value = oldResource;
				};
			});
		}

		public EditCommitResponse CommitEdit(string transactionId) {
			var transaction = GetTransaction(transactionId);
			if (transaction.BaseVersion != version)
				throw new RpcException(ErrorCodes.EditConflict, "The workspace changed after this edit transaction began.");
			var undo = new Stack<Action>();
			try {
				foreach (var operation in transaction.Operations)
					undo.Push(operation.Apply());
			}
			catch (Exception ex) {
				while (undo.TryPop(out var rollback))
					rollback();
				throw new RpcException(ErrorCodes.EditValidationFailed, "The edit transaction could not be applied.", null, ex);
			}
			transactions.Remove(transactionId);
			foreach (var module in transaction.Operations.Select(operation => operation.Module).Distinct())
				module.IsModified = true;
			var previousStateId = stateId;
			stateId = Guid.NewGuid().ToString("N");
			undoHistory.Push(new EditHistoryEntry(transaction.Operations.ToArray(), undo.ToArray(), previousStateId, stateId));
			redoHistory.Clear();
			version++;
			return CreateHistoryResponse(transaction.Operations);
		}

		public void RollbackEdit(string transactionId) {
			if (!transactions.Remove(transactionId))
				throw new RpcException(ErrorCodes.EditTransactionNotFound, "The edit transaction no longer exists.");
		}

		public EditCommitResponse Undo() {
			if (!undoHistory.TryPop(out var history))
				throw new RpcException(ErrorCodes.EditValidationFailed, "There is no edit to undo.");
			foreach (var undo in history.UndoActions)
				undo();
			stateId = history.BeforeStateId;
			redoHistory.Push(history);
			version++;
			return CreateHistoryResponse(history.Operations);
		}

		public EditCommitResponse Redo() {
			if (!redoHistory.TryPop(out var history))
				throw new RpcException(ErrorCodes.EditValidationFailed, "There is no edit to redo.");
			var undo = new Stack<Action>();
			try {
				foreach (var operation in history.Operations)
					undo.Push(operation.Apply());
			}
			catch (Exception ex) {
				while (undo.TryPop(out var rollback))
					rollback();
				redoHistory.Push(history);
				throw new RpcException(ErrorCodes.EditValidationFailed, "The edit could not be reapplied.", null, ex);
			}
			stateId = history.AfterStateId;
			var reapplied = new EditHistoryEntry(history.Operations, undo.ToArray(), history.BeforeStateId, history.AfterStateId);
			undoHistory.Push(reapplied);
			version++;
			return CreateHistoryResponse(history.Operations);
		}

		EditCommitResponse CreateHistoryResponse(IReadOnlyList<EditOperation> operations) => new(
			version,
			stateId,
			operations.Select(operation => operation.NodeId).Distinct(StringComparer.Ordinal).ToArray(),
			undoHistory.Count > 0,
			redoHistory.Count > 0);

		public async Task<SaveModuleResponse> SaveModuleAsync(SaveModuleRequest request, CancellationToken cancellationToken) {
			var module = GetModule(request.ModuleId);
			var destination = Path.GetFullPath(request.DestinationPath);
			var directory = Path.GetDirectoryName(destination);
			if (string.IsNullOrEmpty(directory) || !Directory.Exists(directory))
				throw new RpcException(ErrorCodes.SaveFailed, "The destination directory does not exist.");
			if (File.Exists(destination) && !request.Overwrite)
				throw new RpcException(ErrorCodes.SaveFailed, "The destination already exists.");

			var temporaryPath = Path.Combine(directory, $".{Path.GetFileName(destination)}.{Guid.NewGuid():N}.tmp");
			try {
				await Task.Run(() => module.Module.Write(temporaryPath), cancellationToken).ConfigureAwait(false);
				cancellationToken.ThrowIfCancellationRequested();
				using (var verificationModule = ModuleDefMD.Load(temporaryPath)) {
					_ = verificationModule.Mvid;
					_ = verificationModule.Types.Count;
				}
				File.Move(temporaryPath, destination, request.Overwrite);
				await using var savedFile = new FileStream(destination, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
				var hash = await SHA256.HashDataAsync(savedFile, cancellationToken).ConfigureAwait(false);
				return new SaveModuleResponse(destination, savedFile.Length, Convert.ToHexString(hash).ToLowerInvariant());
			}
			catch (OperationCanceledException) {
				throw;
			}
			catch (Exception ex) when (ex is not RpcException) {
				throw new RpcException(ErrorCodes.SaveFailed, "The module could not be saved.", null, ex);
			}
			finally {
				try {
					if (File.Exists(temporaryPath))
						File.Delete(temporaryPath);
				}
				catch (IOException) {
				}
			}
		}

		EditTransaction GetTransaction(string id) => transactions.TryGetValue(id, out var transaction)
			? transaction
			: throw new RpcException(ErrorCodes.EditTransactionNotFound, "The edit transaction no longer exists.");

		CilBody BuildMethodBody(MethodDef method, ReplaceMethodBodyRequest request) {
			if (request.Instructions.Count == 0 || request.Instructions.Count > 100_000)
				throw new RpcException(ErrorCodes.EditValidationFailed, "A method body must contain between 1 and 100,000 instructions.");
			var body = new CilBody {
				InitLocals = request.InitLocals ?? method.Body?.InitLocals ?? false,
				MaxStack = (ushort)Math.Clamp(request.MaxStack ?? method.Body?.MaxStack ?? 8, 0, ushort.MaxValue),
				KeepOldMaxStack = request.MaxStack is not null,
			};
			if (method.Body is not null) {
				foreach (var local in method.Body.Variables)
					body.Variables.Add(new Local(local.Type));
			}

			var instructions = new Dictionary<string, Instruction>(StringComparer.Ordinal);
			foreach (var source in request.Instructions) {
				if (string.IsNullOrWhiteSpace(source.Label) || instructions.ContainsKey(source.Label))
					throw new RpcException(ErrorCodes.EditValidationFailed, $"Instruction label is empty or duplicated: {source.Label}");
				var opCode = GetOpCode(source.OpCode);
				var instruction = new Instruction(opCode);
				instructions.Add(source.Label, instruction);
				body.Instructions.Add(instruction);
			}

			for (var index = 0; index < request.Instructions.Count; index++) {
				var source = request.Instructions[index];
				body.Instructions[index].Operand = ParseOperand(method, body, body.Instructions[index].OpCode, source, instructions);
			}
			body.UpdateInstructionOffsets();
			return body;
		}

		object? ParseOperand(MethodDef method, CilBody body, OpCode opCode, IlInstructionDto source, IReadOnlyDictionary<string, Instruction> instructions) {
			string RequiredOperand() => source.Operand ?? throw new RpcException(ErrorCodes.EditValidationFailed, $"{opCode.Name} requires an operand.");
			try {
				return opCode.OperandType switch {
					OperandType.InlineNone => null,
					OperandType.ShortInlineI => sbyte.Parse(RequiredOperand(), NumberStyles.Integer, CultureInfo.InvariantCulture),
					OperandType.InlineI => int.Parse(RequiredOperand(), NumberStyles.Integer, CultureInfo.InvariantCulture),
					OperandType.InlineI8 => long.Parse(RequiredOperand(), NumberStyles.Integer, CultureInfo.InvariantCulture),
					OperandType.ShortInlineR => float.Parse(RequiredOperand(), NumberStyles.Float, CultureInfo.InvariantCulture),
					OperandType.InlineR => double.Parse(RequiredOperand(), NumberStyles.Float, CultureInfo.InvariantCulture),
					OperandType.InlineString => RequiredOperand(),
					OperandType.ShortInlineBrTarget or OperandType.InlineBrTarget => GetTarget(RequiredOperand(), instructions),
					OperandType.InlineSwitch => RequiredOperand().Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Select(label => GetTarget(label, instructions)).ToArray(),
					OperandType.ShortInlineVar or OperandType.InlineVar => GetVariableOperand(method, body, source),
					OperandType.InlineType or OperandType.InlineField or OperandType.InlineMethod or OperandType.InlineTok => GetTokenOperand(method.Module, opCode.OperandType, source),
					_ => throw new RpcException(ErrorCodes.EditValidationFailed, $"Operand type {opCode.OperandType} is not supported by the structured IL editor."),
				};
			}
			catch (RpcException) {
				throw;
			}
			catch (Exception ex) when (ex is FormatException or OverflowException or ArgumentOutOfRangeException) {
				throw new RpcException(ErrorCodes.EditValidationFailed, $"The operand for {opCode.Name} is invalid.", null, ex);
			}
		}

		object GetTokenOperand(ModuleDef module, OperandType operandType, IlInstructionDto source) {
			object value;
			if (source.OperandKind?.Equals("token", StringComparison.OrdinalIgnoreCase) == true) {
				if (!uint.TryParse(source.Operand, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var rawToken))
					throw new RpcException(ErrorCodes.EditValidationFailed, "The metadata token operand is invalid.");
				value = module.ResolveToken(rawToken)
					?? throw new RpcException(ErrorCodes.EditValidationFailed, "The metadata token operand could not be resolved.");
			}
			else {
				var nodeId = source.Operand ?? throw new RpcException(ErrorCodes.EditValidationFailed, "The token node ID is missing.");
				value = GetNode(nodeId).Value;
			}
			return operandType switch {
				OperandType.InlineType when value is ITypeDefOrRef type => type,
				OperandType.InlineField when value is IField field => field,
				OperandType.InlineMethod when value is IMethod method => method,
				OperandType.InlineTok when value is ITokenOperand token => token,
				_ => throw new RpcException(ErrorCodes.EditValidationFailed, "The selected node is incompatible with the IL token operand."),
			};
		}

		static object GetVariableOperand(MethodDef method, CilBody body, IlInstructionDto source) {
			var index = int.Parse(source.Operand ?? string.Empty, NumberStyles.None, CultureInfo.InvariantCulture);
			return source.OperandKind?.ToLowerInvariant() switch {
				"local" when index < body.Variables.Count => body.Variables[index],
				"argument" when index < method.Parameters.Count => method.Parameters[index],
				_ => throw new RpcException(ErrorCodes.EditValidationFailed, "Variable operands require a valid local or argument index."),
			};
		}

		static Instruction GetTarget(string label, IReadOnlyDictionary<string, Instruction> instructions) =>
			instructions.TryGetValue(label, out var target)
				? target
				: throw new RpcException(ErrorCodes.EditValidationFailed, $"Branch target does not exist: {label}");

		static readonly IReadOnlyDictionary<string, OpCode> OpCodesByName = typeof(OpCodes)
			.GetFields(BindingFlags.Public | BindingFlags.Static)
			.Where(field => field.FieldType == typeof(OpCode))
			.Select(field => (OpCode)field.GetValue(null)!)
			.ToDictionary(opCode => opCode.Name, StringComparer.OrdinalIgnoreCase);

		static OpCode GetOpCode(string name) => OpCodesByName.TryGetValue(name, out var opCode)
			? opCode
			: throw new RpcException(ErrorCodes.EditValidationFailed, $"Unknown IL opcode: {name}");

		static string? GetEditableName(object value) => value switch {
			TypeDef type => type.Name.String,
			MethodDef method => method.Name.String,
			FieldDef field => field.Name.String,
			PropertyDef property => property.Name.String,
			EventDef @event => @event.Name.String,
			_ => null,
		};

		static void SetEditableName(object value, string name) {
			switch (value) {
				case TypeDef type: type.Name = name; break;
				case MethodDef method: method.Name = name; break;
				case FieldDef field: field.Name = name; break;
				case PropertyDef property: property.Name = name; break;
				case EventDef @event: @event.Name = name; break;
				default: throw new RpcException(ErrorCodes.EditValidationFailed, "The selected item cannot be renamed.");
			}
		}

		ModuleEntry GetModule(string moduleId) => modules.TryGetValue(moduleId, out var module)
			? module
			: throw new RpcException(ErrorCodes.NodeNotFound, "The module no longer exists.");

		NodeEntry GetNode(string nodeId) => nodes.TryGetValue(nodeId, out var node)
			? node
			: throw new RpcException(ErrorCodes.NodeNotFound, "The selected tree node no longer exists.");

		NodeEntry GetMemberNode(IMDTokenProvider member, ModuleEntry module) => GetOrAddNode(
			MemberKey(module, GetKind(member).ToString(), member.MDToken.Raw),
			GetKind(member),
			member,
			module);

		NodeEntry GetOrAddNode(string key, NodeKind kind, object value, ModuleEntry module) {
			if (nodeIdsByKey.TryGetValue(key, out var id))
				return nodes[id];
			id = $"n{(++nextNodeId).ToString(CultureInfo.InvariantCulture)}";
			var entry = new NodeEntry(id, key, kind, value, module);
			nodes.Add(id, entry);
			nodeIdsByKey.Add(key, id);
			return entry;
		}

		static string MemberKey(ModuleEntry module, string kind, uint token) => $"{module.Path}:{kind}:{token:X8}";

		static NodeKind GetKind(IMDTokenProvider provider) => provider switch {
			TypeDef => NodeKind.Type,
			MethodDef => NodeKind.Method,
			FieldDef => NodeKind.Field,
			PropertyDef => NodeKind.Property,
			EventDef => NodeKind.Event,
			_ => throw new ArgumentOutOfRangeException(nameof(provider)),
		};

		static IEnumerable<IMDTokenProvider> EnumerateMembers(TypeDef type) {
			foreach (var field in type.Fields)
				yield return field;
			foreach (var property in type.Properties)
				yield return property;
			foreach (var @event in type.Events)
				yield return @event;
			foreach (var method in type.Methods)
				yield return method;
		}

		static string? GetReferenceIdentity(object? value) => value switch {
			ITypeDefOrRef type => $"T:{type.FullName}",
			IField field => $"F:{field.FullName}",
			IMethod method => $"M:{method.FullName}",
			PropertyDef property => $"P:{property.FullName}",
			EventDef @event => $"E:{@event.FullName}",
			_ => null,
		};

		static bool ReferencesTarget(object? value, string targetIdentity) {
			if (GetReferenceIdentity(value) == targetIdentity)
				return true;
			if (!targetIdentity.StartsWith("T:", StringComparison.Ordinal))
				return false;
			var declaringType = value switch {
				IMethod method => method.DeclaringType,
				IField field => field.DeclaringType,
				_ => null,
			};
			return declaringType is not null && $"T:{declaringType.FullName}" == targetIdentity;
		}

		static string GetMemberDisplayName(IMDTokenProvider member) => member switch {
			TypeDef type => type.FullName,
			MethodDef method => $"{method.Name}{FormatParameterList(method)}",
			FieldDef field => field.Name.String,
			PropertyDef property => property.Name.String,
			EventDef @event => @event.Name.String,
			_ => member.ToString() ?? string.Empty,
		};

		static string FormatParameterList(MethodDef method) => $"({string.Join(", ", method.Parameters.Where(p => !p.IsHiddenThisParameter).Select(p => p.Type.TypeName))})";

		static TreeNodeDto ToDto(NodeEntry node) => new(
			node.Id,
			GetLabel(node),
			node.Kind.ToString().ToLowerInvariant(),
			HasChildren(node),
			GetDescription(node),
			GetIcon(node));

		static string GetLabel(NodeEntry node) => node.Kind switch {
			NodeKind.Module => ((ModuleDefMD)node.Value).Assembly?.Name.String ?? ((ModuleDefMD)node.Value).Name.String,
			NodeKind.Namespace => string.IsNullOrEmpty(((NamespaceValue)node.Value).Name) ? "-" : ((NamespaceValue)node.Value).Name,
			NodeKind.ReferencesGroup => "Assembly References",
			NodeKind.ResourcesGroup => "Resources",
			NodeKind.AssemblyReference => ((AssemblyRef)node.Value).Name.String,
			NodeKind.Resource => ((Resource)node.Value).Name,
			NodeKind.ResourceEntry => ((ResourceEntryValue)node.Value).Name,
			NodeKind.Type or NodeKind.Method or NodeKind.Field or NodeKind.Property or NodeKind.Event => GetMemberDisplayName((IMDTokenProvider)node.Value),
			_ => node.Kind.ToString(),
		};

		static string? GetDescription(NodeEntry node) => node.Kind switch {
			NodeKind.Module => node.Module.Path,
			NodeKind.AssemblyReference => ((AssemblyRef)node.Value).FullName,
			NodeKind.Resource => DescribeResource((Resource)node.Value),
			NodeKind.ResourceEntry => DescribeResourceEntry((ResourceEntryValue)node.Value),
			NodeKind.Type => ((TypeDef)node.Value).FullName,
			NodeKind.Method => ((MethodDef)node.Value).FullName,
			NodeKind.Field => ((FieldDef)node.Value).FullName,
			_ => null,
		};

		static bool HasChildren(NodeEntry node) => node.Kind switch {
			NodeKind.Module or NodeKind.Namespace or NodeKind.ReferencesGroup or NodeKind.ResourcesGroup => true,
			NodeKind.Resource => node.Value is EmbeddedResource resource && resource.Name.EndsWith(".resources", StringComparison.OrdinalIgnoreCase),
			NodeKind.Type => ((TypeDef)node.Value).NestedTypes.Count + ((TypeDef)node.Value).Fields.Count + ((TypeDef)node.Value).Properties.Count + ((TypeDef)node.Value).Events.Count + ((TypeDef)node.Value).Methods.Count != 0,
			_ => false,
		};

		static string GetIcon(NodeEntry node) => node.Kind switch {
			NodeKind.Module => "assembly",
			NodeKind.Namespace => "namespace",
			NodeKind.ReferencesGroup or NodeKind.AssemblyReference => "reference",
			NodeKind.ResourcesGroup or NodeKind.Resource or NodeKind.ResourceEntry => "resource",
			NodeKind.Type => ((TypeDef)node.Value).IsInterface ? "interface" : ((TypeDef)node.Value).IsEnum ? "enum" : "class",
			NodeKind.Method => "method",
			NodeKind.Field => "field",
			NodeKind.Property => "property",
			NodeKind.Event => "event",
			_ => "item",
		};

		static string DescribeResource(Resource resource) => resource switch {
			EmbeddedResource embedded => $"Embedded resource, {embedded.Length:N0} bytes",
			AssemblyLinkedResource linked => $"Assembly-linked resource: {linked.Assembly?.FullName}",
			LinkedResource linked => $"Linked resource: {linked.File}",
			_ => resource.ResourceType.ToString(),
		};

		static string DescribeResourceEntry(ResourceEntryValue value) => value.Value switch {
			byte[] bytes => $"{Path.GetExtension(value.Name).TrimStart('.').ToUpperInvariant()} resource, {bytes.Length:N0} bytes",
			string text => $"Text resource, {text.Length:N0} characters",
			null => "Null resource",
			_ => value.Value.GetType().FullName ?? "Resource",
		};

		public async Task<T> RunAsync<T>(Func<Workspace, T> action, CancellationToken cancellationToken) {
			await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
			try {
				ObjectDisposedException.ThrowIf(disposed, this);
				return action(this);
			}
			finally {
				gate.Release();
			}
		}

		public async Task<T> RunAsync<T>(Func<Workspace, Task<T>> action, CancellationToken cancellationToken) {
			await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
			try {
				ObjectDisposedException.ThrowIf(disposed, this);
				return await action(this).ConfigureAwait(false);
			}
			finally {
				gate.Release();
			}
		}

		public void Dispose() {
			if (disposed)
				return;
			disposed = true;
			foreach (var module in modules.Values)
				module.Module.Dispose();
			modules.Clear();
			nodes.Clear();
			nodeIdsByKey.Clear();
			transactions.Clear();
			undoHistory.Clear();
			redoHistory.Clear();
			gate.Dispose();
		}

		sealed class ModuleEntry(string path, ModuleDefMD module) {
			public string Id { get; set; } = string.Empty;
			public string Path { get; } = path;
			public ModuleDefMD Module { get; } = module;
			public long FileLength { get; } = new FileInfo(path).Length;
			public bool IsModified { get; set; }
		}

		sealed record NamespaceValue(string Name, IReadOnlyList<TypeDef> Types);
		sealed record ResourceEntryValue(string Name, object? Value, string TypeName);
		sealed record MetadataReference(DecompilerMetadataFile Metadata, System.Reflection.Metadata.Handle Handle);
		sealed class NodeEntry(string id, string key, NodeKind kind, object value, ModuleEntry module) {
			public string Id { get; } = id;
			public string Key { get; } = key;
			public NodeKind Kind { get; } = kind;
			public object Value { get; set; } = value;
			public ModuleEntry Module { get; } = module;
		}

		sealed class EditTransaction(int baseVersion) {
			public string Id { get; } = Guid.NewGuid().ToString("N");
			public int BaseVersion { get; } = baseVersion;
			public List<EditOperation> Operations { get; } = [];

			public void Add(string nodeId, ModuleEntry module, Func<Action> apply) => Operations.Add(new EditOperation(nodeId, module, apply));
		}

		sealed record EditOperation(string NodeId, ModuleEntry Module, Func<Action> Apply);
		sealed record EditHistoryEntry(IReadOnlyList<EditOperation> Operations, IReadOnlyList<Action> UndoActions, string BeforeStateId, string AfterStateId);

		sealed class SpanTextOutput(Func<object, string?> resolveTarget) : ITextOutput {
			readonly StringBuilder builder = new();
			readonly List<TextSpanDto> spans = [];
			int indentation;
			bool needsIndentation = true;

			public string IndentationString { get; set; } = "\t";
			public IReadOnlyList<TextSpanDto> Spans => spans;

			public void Indent() => indentation++;
			public void Unindent() => indentation = Math.Max(0, indentation - 1);
			public void Write(char ch) => Write(ch.ToString());
			public void Write(string text) {
				EnsureIndentation();
				builder.Append(text);
			}
			public void WriteLine() {
				builder.AppendLine();
				needsIndentation = true;
			}
			public void WriteReference(OpCodeInfo opCode, bool omitSuffix = false) => Write(omitSuffix ? opCode.Name ?? string.Empty : opCode.ToString() ?? string.Empty);
			public void WriteReference(DecompilerMetadataFile metadata, System.Reflection.Metadata.Handle handle, string text, string protocol = "decompile", bool isDefinition = false) =>
				WriteReferenceCore(new MetadataReference(metadata, handle), text, isDefinition);
			public void WriteReference(DecompilerIType type, string text, bool isDefinition = false) => WriteReferenceCore(type, text, isDefinition);
			public void WriteReference(DecompilerIMember member, string text, bool isDefinition = false) => WriteReferenceCore(member, text, isDefinition);
			public void WriteLocalReference(string text, object reference, bool isDefinition = false, bool isHoverOnly = false) => Write(text);
			public void MarkFoldStart(string collapsedText = "...", bool defaultCollapsed = false, bool isDefinition = false) { }
			public void MarkDefinitionStart() { }
			public void MarkFoldEnd() { }

			void WriteReferenceCore(object reference, string text, bool isDefinition) {
				EnsureIndentation();
				var start = builder.Length;
				builder.Append(text);
				var target = resolveTarget(reference);
				if (target is not null && text.Length > 0)
					spans.Add(new TextSpanDto(start, text.Length, isDefinition ? "definition" : "reference", target));
			}

			void EnsureIndentation() {
				if (!needsIndentation)
					return;
				for (var i = 0; i < indentation; i++)
					builder.Append(IndentationString);
				needsIndentation = false;
			}

			public override string ToString() => builder.ToString();
		}

		enum NodeKind {
			Module,
			Namespace,
			ReferencesGroup,
			ResourcesGroup,
			AssemblyReference,
			Resource,
			ResourceEntry,
			Type,
			Method,
			Field,
			Property,
			Event,
		}

		static class ILFormatter {
			public static string Format(NodeEntry node) {
				var builder = new StringBuilder();
				switch (node.Value) {
					case ModuleDef module:
						builder.AppendLine($"// {module.Assembly?.FullName ?? module.Name.String}");
						builder.AppendLine($".module {module.Name}");
						foreach (var type in module.Types.Where(t => !t.IsGlobalModuleType))
							FormatTypeHeader(builder, type);
						break;
					case NamespaceValue ns:
						builder.AppendLine($"// namespace {ns.Name}");
						foreach (var type in ns.Types)
							FormatType(builder, type);
						break;
					case TypeDef type:
						FormatType(builder, type);
						break;
					case MethodDef method:
						FormatMethod(builder, method);
						break;
					case FieldDef field:
						builder.AppendLine($".field {field.Attributes} {field.FieldType.FullName} {field.Name}");
						break;
					case PropertyDef property:
						builder.AppendLine($".property {property.PropertySig?.RetType.FullName ?? "<unknown>"} {property.Name}");
						break;
					case EventDef @event:
						builder.AppendLine($".event {@event.EventType.FullName} {@event.Name}");
						break;
					case AssemblyRef reference:
						builder.AppendLine($".assembly extern {reference.Name}");
						builder.AppendLine("{");
						builder.AppendLine($"  .ver {reference.Version}");
						builder.AppendLine("}");
						break;
					case Resource resource:
						builder.AppendLine($".mresource {resource.Attributes} '{resource.Name}'");
						break;
					default:
						throw new RpcException(ErrorCodes.UnsupportedDocument, "This tree node has no IL representation.");
				}
				return builder.ToString();
			}

			static void FormatTypeHeader(StringBuilder builder, TypeDef type) => builder.AppendLine($".class {type.Attributes} {type.FullName}");

			static void FormatType(StringBuilder builder, TypeDef type) {
				FormatTypeHeader(builder, type);
				builder.AppendLine("{");
				foreach (var field in type.Fields)
					builder.AppendLine($"  .field {field.Attributes} {field.FieldType.FullName} {field.Name}");
				foreach (var method in type.Methods) {
					builder.AppendLine();
					FormatMethod(builder, method, "  ");
				}
				builder.AppendLine("}");
			}

			static void FormatMethod(StringBuilder builder, MethodDef method, string indent = "") {
				builder.AppendLine($"{indent}.method {method.Attributes} {method.ReturnType.FullName} {method.Name}{FormatParameterList(method)}");
				builder.AppendLine($"{indent}{{");
				if (method.HasBody) {
					builder.AppendLine($"{indent}  .maxstack {method.Body.MaxStack}");
					if (method.Body.HasVariables) {
						builder.AppendLine($"{indent}  .locals {string.Join(", ", method.Body.Variables.Select(v => $"[{v.Index}] {v.Type.FullName}"))}");
					}
					foreach (var instruction in method.Body.Instructions)
						builder.AppendLine($"{indent}  IL_{instruction.Offset:X4}: {instruction.OpCode.Name,-12} {FormatOperand(instruction.Operand)}".TrimEnd());
				}
				builder.AppendLine($"{indent}}}");
			}

			static string FormatOperand(object? operand) => operand switch {
				null => string.Empty,
				string text => $"\"{text.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal)}\"",
				Instruction instruction => $"IL_{instruction.Offset:X4}",
				IList<Instruction> instructions => string.Join(", ", instructions.Select(i => $"IL_{i.Offset:X4}")),
				IMemberRef member => member.FullName,
				IType type => type.FullName,
				Local local => $"V_{local.Index}",
				Parameter parameter => parameter.Name ?? $"A_{parameter.Index}",
				float value => value.ToString("R", CultureInfo.InvariantCulture),
				double value => value.ToString("R", CultureInfo.InvariantCulture),
				IFormattable value => value.ToString(null, CultureInfo.InvariantCulture),
				_ => operand.ToString() ?? string.Empty,
			};
		}
	}
}
