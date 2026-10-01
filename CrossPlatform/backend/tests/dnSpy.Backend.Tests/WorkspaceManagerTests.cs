using dnSpy.Backend.Contracts;
using dnSpy.Backend.Core;
using Xunit;

namespace dnSpy.Backend.Tests;

public sealed class WorkspaceManagerTests : IDisposable {
	readonly WorkspaceManager manager = new();

	[Fact]
	public async Task OpensAssemblyAndProvidesLazyTreeAndDecompilation() {
		var opened = await OpenContractsAssemblyAsync();
		var roots = await manager.GetRootsAsync(new WorkspaceRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);

		var module = Assert.Single(roots.Nodes);
		Assert.Equal(opened.Modules[0].Id, module.Id);
		Assert.Equal("module", module.Kind);
		Assert.True(module.HasChildren);

		var moduleChildren = await manager.GetChildrenAsync(
			new NodeRequest(opened.WorkspaceId, module.Id),
			TestContext.Current.CancellationToken);
		var contractNamespace = Assert.Single(moduleChildren.Nodes, n => n.Label == "dnSpy.Backend.Contracts");

		var namespaceChildren = await manager.GetChildrenAsync(
			new NodeRequest(opened.WorkspaceId, contractNamespace.Id),
			TestContext.Current.CancellationToken);
		var helloRequest = Assert.Single(namespaceChildren.Nodes, n => n.Label == "dnSpy.Backend.Contracts.HelloRequest");

		var csharp = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, helloRequest.Id, DecompilerLanguage.CSharp),
			TestContext.Current.CancellationToken);
		Assert.Equal("csharp", csharp.Language);
		Assert.Contains("record HelloRequest", csharp.Text, StringComparison.Ordinal);
		Assert.Contains(csharp.Spans, span => span.Kind == "definition" && span.TargetNodeId == helloRequest.Id);

		var il = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, helloRequest.Id, DecompilerLanguage.IL),
			TestContext.Current.CancellationToken);
		Assert.Equal("il", il.Language);
		Assert.Contains(".class", il.Text, StringComparison.Ordinal);
		Assert.Contains("HelloRequest", il.Text, StringComparison.Ordinal);

		var rpcException = Assert.Single(namespaceChildren.Nodes, n => n.Label == "dnSpy.Backend.Contracts.RpcException");
		var rpcMembers = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, rpcException.Id), TestContext.Current.CancellationToken);
		var getCode = Assert.Single(rpcMembers.Nodes, member => member.Label == "get_Code()");
		var getCodeDocument = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, getCode.Id, DecompilerLanguage.CSharp),
			TestContext.Current.CancellationToken);
		Assert.Contains(getCodeDocument.Spans, span => span.Kind == "reference" && span.TargetNodeId is not null && span.TargetNodeId != getCode.Id);
		var visualBasic = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, rpcException.Id, DecompilerLanguage.VisualBasic),
			TestContext.Current.CancellationToken);
		Assert.Equal("visual-basic", visualBasic.Language);
		Assert.Contains("Class RpcException", visualBasic.Text, StringComparison.OrdinalIgnoreCase);
	}

	[Fact]
	public async Task SearchesNamesAndStringLiterals() {
		var opened = await OpenContractsAssemblyAsync();

		var types = await manager.SearchAsync(
			new SearchRequest(opened.WorkspaceId, "HexReadResponse", ["type"]),
			TestContext.Current.CancellationToken);
		var type = Assert.Single(types.Results);
		Assert.Equal("type", type.Kind);

		var testAssembly = await manager.OpenAsync(
			new OpenWorkspaceRequest([typeof(WorkspaceManagerTests).Assembly.Location]),
			TestContext.Current.CancellationToken);
		var strings = await manager.SearchAsync(
			new SearchRequest(testAssembly.WorkspaceId, "HexReadResponse", ["string"]),
			TestContext.Current.CancellationToken);
		Assert.NotEmpty(strings.Results);
	}

	[Fact]
	public async Task FindsReferencesAcrossOpenedModules() {
		var opened = await manager.OpenAsync(
			new OpenWorkspaceRequest([typeof(HelloRequest).Assembly.Location, typeof(WorkspaceManager).Assembly.Location]),
			TestContext.Current.CancellationToken);
		var roots = await manager.GetRootsAsync(new WorkspaceRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);
		var contractsRoot = Assert.Single(roots.Nodes, node => node.Label == "dnSpy.Backend.Contracts");
		var moduleChildren = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, contractsRoot.Id), TestContext.Current.CancellationToken);
		var contractsNamespace = Assert.Single(moduleChildren.Nodes, node => node.Label == "dnSpy.Backend.Contracts");
		var types = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, contractsNamespace.Id), TestContext.Current.CancellationToken);
		var rpcException = Assert.Single(types.Nodes, node => node.Label == "dnSpy.Backend.Contracts.RpcException");
		var references = await manager.AnalyzeReferencesAsync(
			new AnalyzeReferencesRequest(opened.WorkspaceId, rpcException.Id),
			TestContext.Current.CancellationToken);
		Assert.NotEmpty(references.Results);
		Assert.Contains(references.Results, reference => reference.Location.StartsWith("IL_", StringComparison.Ordinal));
	}

	[Fact]
	public async Task ReturnsModuleMetadataAndBoundedHexRanges() {
		var opened = await OpenContractsAssemblyAsync();
		var moduleId = Assert.Single(opened.Modules).Id;

		var info = await manager.GetModuleInfoAsync(
			new ModuleInfoRequest(opened.WorkspaceId, moduleId),
			TestContext.Current.CancellationToken);
		Assert.Contains("dnSpy.Backend.Contracts", info.Name, StringComparison.Ordinal);
		Assert.NotEqual(Guid.Empty, info.Mvid);
		Assert.True(info.TypeCount > 10);
		Assert.True(info.MetadataTables["TypeDef"] > 10);
		Assert.Equal("PE32", info.PeHeaders["PE magic"]);

		var length = await manager.GetHexLengthAsync(
			new HexLengthRequest(opened.WorkspaceId, moduleId),
			TestContext.Current.CancellationToken);
		Assert.True(length.Length > 512);

		var firstBytes = await manager.ReadHexAsync(
			new HexReadRequest(opened.WorkspaceId, moduleId, 0, 64),
			TestContext.Current.CancellationToken);
		var bytes = Convert.FromBase64String(firstBytes.Base64Data);
		Assert.Equal(64, bytes.Length);
		Assert.Equal((byte)'M', bytes[0]);
		Assert.Equal((byte)'Z', bytes[1]);
		Assert.False(firstBytes.EndOfFile);

		var exception = await Assert.ThrowsAsync<RpcException>(() => manager.ReadHexAsync(
			new HexReadRequest(opened.WorkspaceId, moduleId, 0, 1024 * 1024 + 1),
			TestContext.Current.CancellationToken));
		Assert.Equal(ErrorCodes.RangeTooLarge, exception.Code);
	}

	[Fact]
	public async Task ClosingWorkspaceReleasesItsPublicIdentity() {
		var opened = await OpenContractsAssemblyAsync();
		manager.Close(new WorkspaceRequest(opened.WorkspaceId));

		var exception = await Assert.ThrowsAsync<RpcException>(() => manager.GetRootsAsync(
			new WorkspaceRequest(opened.WorkspaceId),
			TestContext.Current.CancellationToken));
		Assert.Equal(ErrorCodes.WorkspaceNotFound, exception.Code);
	}

	[Fact]
	public void CoreAssemblyDoesNotReferenceDesktopUiFrameworks() {
		var forbidden = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
			"PresentationCore",
			"PresentationFramework",
			"System.Windows.Forms",
			"WindowsBase",
		};
		var references = typeof(WorkspaceManager).Assembly.GetReferencedAssemblies().Select(a => a.Name).ToArray();
		Assert.DoesNotContain(references, name => name is not null && forbidden.Contains(name));
	}

	[Fact]
	public async Task CommitsRenameDetectsConflictsAndSavesVerifiedCopy() {
		var opened = await OpenContractsAssemblyAsync();
		var helloRequest = await FindTypeAsync(opened.WorkspaceId, "dnSpy.Backend.Contracts", "dnSpy.Backend.Contracts.HelloRequest");
		var first = await manager.BeginEditAsync(new BeginEditRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);
		var conflicting = await manager.BeginEditAsync(new BeginEditRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);

		await manager.QueueRenameAsync(
			new RenameEditRequest(opened.WorkspaceId, first.TransactionId, helloRequest.Id, "HelloRequestRenamed"),
			TestContext.Current.CancellationToken);
		var committed = await manager.CommitEditAsync(
			new EditTransactionRequest(opened.WorkspaceId, first.TransactionId),
			TestContext.Current.CancellationToken);
		Assert.Equal(1, committed.Version);
		Assert.Contains(helloRequest.Id, committed.ChangedNodeIds);
		var renamedCSharp = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, helloRequest.Id, DecompilerLanguage.CSharp),
			TestContext.Current.CancellationToken);
		Assert.Contains("record HelloRequestRenamed", renamedCSharp.Text, StringComparison.Ordinal);

		await manager.QueueRenameAsync(
			new RenameEditRequest(opened.WorkspaceId, conflicting.TransactionId, helloRequest.Id, "ConflictingName"),
			TestContext.Current.CancellationToken);
		var conflict = await Assert.ThrowsAsync<RpcException>(() => manager.CommitEditAsync(
			new EditTransactionRequest(opened.WorkspaceId, conflicting.TransactionId),
			TestContext.Current.CancellationToken));
		Assert.Equal(ErrorCodes.EditConflict, conflict.Code);
		await manager.RollbackEditAsync(
			new EditTransactionRequest(opened.WorkspaceId, conflicting.TransactionId),
			TestContext.Current.CancellationToken);
		var undone = await manager.UndoAsync(new WorkspaceRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);
		Assert.False(undone.CanUndo);
		Assert.True(undone.CanRedo);
		var originalCSharp = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, helloRequest.Id, DecompilerLanguage.CSharp),
			TestContext.Current.CancellationToken);
		Assert.Contains("record HelloRequest(", originalCSharp.Text, StringComparison.Ordinal);
		var redone = await manager.RedoAsync(new WorkspaceRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);
		Assert.True(redone.CanUndo);
		Assert.False(redone.CanRedo);

		var destination = Path.Combine(Path.GetTempPath(), $"dnspy-edit-{Guid.NewGuid():N}.dll");
		try {
			var saved = await manager.SaveModuleAsync(
				new SaveModuleRequest(opened.WorkspaceId, opened.Modules[0].Id, destination),
				TestContext.Current.CancellationToken);
			Assert.Equal(destination, saved.Path);
			Assert.True(saved.Length > 512);
			Assert.Equal(64, saved.Sha256.Length);

			var reopened = await manager.OpenAsync(
				new OpenWorkspaceRequest([destination]),
				TestContext.Current.CancellationToken);
			var results = await manager.SearchAsync(
				new SearchRequest(reopened.WorkspaceId, "HelloRequestRenamed", ["type"]),
				TestContext.Current.CancellationToken);
			Assert.Single(results.Results);
		}
		finally {
			File.Delete(destination);
		}
	}

	[Fact]
	public async Task ReplacesStructuredIlMethodBody() {
		var opened = await OpenContractsAssemblyAsync();
		var rpcException = await FindTypeAsync(opened.WorkspaceId, "dnSpy.Backend.Contracts", "dnSpy.Backend.Contracts.RpcException");
		var members = await manager.GetChildrenAsync(
			new NodeRequest(opened.WorkspaceId, rpcException.Id),
			TestContext.Current.CancellationToken);
		var getCode = Assert.Single(members.Nodes, node => node.Label == "get_Code()");
		var transaction = await manager.BeginEditAsync(new BeginEditRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);

		await manager.QueueMethodBodyAsync(new ReplaceMethodBodyRequest(
			opened.WorkspaceId,
			transaction.TransactionId,
			getCode.Id,
			[
				new IlInstructionDto("L0", "ldc.i4", "int32", "42"),
				new IlInstructionDto("L1", "ret"),
			],
			MaxStack: 1), TestContext.Current.CancellationToken);
		await manager.CommitEditAsync(
			new EditTransactionRequest(opened.WorkspaceId, transaction.TransactionId),
			TestContext.Current.CancellationToken);

		var il = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, getCode.Id, DecompilerLanguage.IL),
			TestContext.Current.CancellationToken);
		Assert.Contains("ldc.i4", il.Text, StringComparison.Ordinal);
		Assert.Contains("42", il.Text, StringComparison.Ordinal);
		var csharp = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, getCode.Id, DecompilerLanguage.CSharp),
			TestContext.Current.CancellationToken);
		Assert.Contains("42", csharp.Text, StringComparison.Ordinal);
	}

	[Fact]
	public async Task RoundTripsEditableMethodBodyWithMetadataTokens() {
		var opened = await OpenContractsAssemblyAsync();
		var rpcException = await FindTypeAsync(opened.WorkspaceId, "dnSpy.Backend.Contracts", "dnSpy.Backend.Contracts.RpcException");
		var members = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, rpcException.Id), TestContext.Current.CancellationToken);
		var getCode = Assert.Single(members.Nodes, node => node.Label == "get_Code()");
		var body = await manager.GetMethodBodyAsync(
			new MethodBodyRequest(opened.WorkspaceId, getCode.Id),
			TestContext.Current.CancellationToken);
		Assert.Contains(body.Instructions, instruction => instruction.OperandKind == "token");

		var transaction = await manager.BeginEditAsync(new BeginEditRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);
		await manager.QueueMethodBodyAsync(new ReplaceMethodBodyRequest(
			opened.WorkspaceId,
			transaction.TransactionId,
			getCode.Id,
			body.Instructions,
			body.MaxStack,
			body.InitLocals), TestContext.Current.CancellationToken);
		await manager.CommitEditAsync(new EditTransactionRequest(opened.WorkspaceId, transaction.TransactionId), TestContext.Current.CancellationToken);

		var il = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, getCode.Id, DecompilerLanguage.IL),
			TestContext.Current.CancellationToken);
		Assert.Contains("ldfld", il.Text, StringComparison.Ordinal);
		Assert.Contains("ret", il.Text, StringComparison.Ordinal);
	}

	[Fact]
	public async Task ReplacesEmbeddedResourceTransactionally() {
		var opened = await manager.OpenAsync(
			new OpenWorkspaceRequest([typeof(WorkspaceManagerTests).Assembly.Location]),
			TestContext.Current.CancellationToken);
		var root = Assert.Single((await manager.GetRootsAsync(new WorkspaceRequest(opened.WorkspaceId), TestContext.Current.CancellationToken)).Nodes);
		var moduleChildren = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, root.Id), TestContext.Current.CancellationToken);
		var resources = Assert.Single(moduleChildren.Nodes, node => node.Kind == "resourcesgroup");
		var resourceNodes = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, resources.Id), TestContext.Current.CancellationToken);
		var resource = Assert.Single(resourceNodes.Nodes, node => node.Label.EndsWith("sample-resource.txt", StringComparison.Ordinal));
		var transaction = await manager.BeginEditAsync(new BeginEditRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);

		await manager.QueueResourceAsync(
			new ReplaceResourceRequest(opened.WorkspaceId, transaction.TransactionId, resource.Id, Convert.ToBase64String("updated"u8)),
			TestContext.Current.CancellationToken);
		await manager.CommitEditAsync(new EditTransactionRequest(opened.WorkspaceId, transaction.TransactionId), TestContext.Current.CancellationToken);

		var refreshed = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, resources.Id), TestContext.Current.CancellationToken);
		var updated = Assert.Single(refreshed.Nodes, node => node.Id == resource.Id);
		Assert.Contains("7 bytes", updated.Description, StringComparison.Ordinal);
	}

	[Fact]
	public async Task ExpandsDotResourcesAndDecompilesBamlToXaml() {
		var target = Path.GetFullPath(Path.Combine(
			AppContext.BaseDirectory,
			"..", "..", "..", "..", "BamlTarget", "bin", TestConfiguration, "net10.0-windows", "BamlTarget.dll"));
		Assert.True(File.Exists(target), $"BAML fixture was not built: {target}");
		var opened = await manager.OpenAsync(new OpenWorkspaceRequest([target]), TestContext.Current.CancellationToken);
		var root = Assert.Single((await manager.GetRootsAsync(new WorkspaceRequest(opened.WorkspaceId), TestContext.Current.CancellationToken)).Nodes);
		var moduleChildren = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, root.Id), TestContext.Current.CancellationToken);
		var resources = Assert.Single(moduleChildren.Nodes, node => node.Kind == "resourcesgroup");
		var resourceNodes = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, resources.Id), TestContext.Current.CancellationToken);
		var generatedResources = Assert.Single(resourceNodes.Nodes, node => node.Label.EndsWith(".g.resources", StringComparison.OrdinalIgnoreCase));
		Assert.True(generatedResources.HasChildren);
		var entries = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, generatedResources.Id), TestContext.Current.CancellationToken);
		var baml = Assert.Single(entries.Nodes, node => node.Label.EndsWith(".baml", StringComparison.OrdinalIgnoreCase));

		var xaml = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, baml.Id, DecompilerLanguage.CSharp),
			TestContext.Current.CancellationToken);
		Assert.Equal("xml", xaml.Language);
		Assert.False(xaml.Diagnostics.Any(diagnostic => diagnostic.Severity == "error"), $"BAML decompilation failed: {string.Join("; ", xaml.Diagnostics.Select(diagnostic => diagnostic.Message))}");
		Assert.Contains("UserControl", xaml.Text, StringComparison.Ordinal);
		Assert.Contains("BAML fixture", xaml.Text, StringComparison.Ordinal);
	}

	async Task<TreeNodeDto> FindTypeAsync(string workspaceId, string namespaceName, string typeName) {
		var root = Assert.Single((await manager.GetRootsAsync(new WorkspaceRequest(workspaceId), TestContext.Current.CancellationToken)).Nodes);
		var rootChildren = await manager.GetChildrenAsync(new NodeRequest(workspaceId, root.Id), TestContext.Current.CancellationToken);
		var @namespace = Assert.Single(rootChildren.Nodes, node => node.Label == namespaceName);
		var types = await manager.GetChildrenAsync(new NodeRequest(workspaceId, @namespace.Id), TestContext.Current.CancellationToken);
		return Assert.Single(types.Nodes, node => node.Label == typeName);
	}

	async Task<OpenWorkspaceResponse> OpenContractsAssemblyAsync() => await manager.OpenAsync(
		new OpenWorkspaceRequest([typeof(HelloRequest).Assembly.Location]),
		TestContext.Current.CancellationToken);

	public void Dispose() => manager.Dispose();

	static string TestConfiguration => new DirectoryInfo(AppContext.BaseDirectory).Parent?.Name
		?? throw new InvalidOperationException("Could not determine the test configuration.");
}
