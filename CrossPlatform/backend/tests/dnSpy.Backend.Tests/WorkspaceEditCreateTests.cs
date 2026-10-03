using dnlib.DotNet;
using dnSpy.Backend.Contracts;
using dnSpy.Backend.Core;
using Xunit;

namespace dnSpy.Backend.Tests;

/// <summary>
/// The writing half of the create/edit dialogs: a dialog's model is queued, committed, and has to leave the
/// module in a state that saves and reopens — and that undo and redo can walk back and forth over.
/// </summary>
public sealed class WorkspaceEditCreateTests : IDisposable {
	readonly WorkspaceManager manager = new();

	[Fact]
	public async Task CreatingAMethodPutsItInTheOwnerTypeAndNamesItsNode() {
		var workspaceId = await OpenContractsAssemblyAsync();
		var type = await FindTypeAsync(workspaceId, "dnSpy.Backend.Contracts.RpcException");
		var options = await NewOptionsAsync(workspaceId, NodeOptionKinds.Method, type.Id);
		var created = await CreateAsync(workspaceId, type.Id, options);

		Assert.Equal("method", created.Kind);
		var members = await MembersAsync(workspaceId, type.Id);
		var method = Assert.Single(members, node => node.Id == created.NodeId);
		// A method with no parameters is named with its empty parameter list, the way the tree names every
		// method — which is also what tells us the row really is in the type now.
		Assert.Equal("MyMethod()", method.Label);
		Assert.Equal("method", method.Kind);
	}

	[Fact]
	public async Task CreatingATypeInANamespacePutsItInTheModuleAndNotInTheType() {
		var workspaceId = await OpenContractsAssemblyAsync();
		var type = await FindTypeAsync(workspaceId, "dnSpy.Backend.Contracts.RpcException");
		var @namespace = await NamespaceOfAsync(workspaceId, type);

		var created = await CreateAsync(workspaceId, @namespace.Id, await NewOptionsAsync(workspaceId, NodeOptionKinds.Type, @namespace.Id));

		Assert.Equal("type", created.Kind);
		Assert.Equal("dnSpy.Backend.Contracts.MyType", created.Label);
		var types = await ChildrenAsync(workspaceId, @namespace.Id);
		Assert.Contains(types, node => node.Id == created.NodeId);
		// A top-level type is not a nested one, so the type it was created from is untouched.
		var nestedInSelected = await ChildrenAsync(workspaceId, type.Id);
		Assert.DoesNotContain(nestedInSelected, node => node.Id == created.NodeId);

		var nested = await CreateAsync(workspaceId, type.Id, await NewOptionsAsync(workspaceId, NodeOptionKinds.Type, type.Id));
		Assert.Equal("dnSpy.Backend.Contracts.RpcException+MyType", nested.Label);
		var nestedTypes = await ChildrenAsync(workspaceId, type.Id);
		Assert.Contains(nestedTypes, node => node.Id == nested.NodeId && node.Kind == "type");
	}

	[Fact]
	public async Task UndoingACreationTakesTheRowOutAndRedoPutsTheSameOneBack() {
		var workspaceId = await OpenContractsAssemblyAsync();
		var type = await FindTypeAsync(workspaceId, "dnSpy.Backend.Contracts.RpcException");
		var created = await CreateAsync(workspaceId, type.Id, await NewOptionsAsync(workspaceId, NodeOptionKinds.Method, type.Id));

		await manager.UndoAsync(new WorkspaceRequest(workspaceId), TestContext.Current.CancellationToken);
		var afterUndo = await MembersAsync(workspaceId, type.Id);
		Assert.DoesNotContain(afterUndo, node => node.Id == created.NodeId);

		await manager.RedoAsync(new WorkspaceRequest(workspaceId), TestContext.Current.CancellationToken);
		var afterRedo = await MembersAsync(workspaceId, type.Id);
		// The node id is the module, the kind and the row's token, so a node id that survived the round trip
		// is the same row in the metadata — not a second one that happens to look like it.
		var restored = Assert.Single(afterRedo, node => node.Id == created.NodeId);
		Assert.Equal(created.Label, restored.Label);
	}

	[Fact]
	public async Task ANewMethodHasNoBodyUntilOneIsWritten() {
		var workspaceId = await OpenContractsAssemblyAsync();
		var type = await FindTypeAsync(workspaceId, "dnSpy.Backend.Contracts.RpcException");
		var created = await CreateAsync(workspaceId, type.Id, await NewOptionsAsync(workspaceId, NodeOptionKinds.Method, type.Id));

		var exception = await Assert.ThrowsAsync<RpcException>(() => manager.GetMethodBodyAsync(
			new MethodBodyRequest(workspaceId, created.NodeId),
			TestContext.Current.CancellationToken));
		Assert.Equal(ErrorCodes.EditValidationFailed, exception.Code);

		// Which "Replace Method Body with stub..." can fix, since the method is a real row in the type.
		var transaction = await manager.BeginEditAsync(new BeginEditRequest(workspaceId), TestContext.Current.CancellationToken);
		await manager.QueueMethodBodyStubAsync(
			new ReplaceMethodBodyWithStubRequest(workspaceId, transaction.TransactionId, created.NodeId),
			TestContext.Current.CancellationToken);
		await manager.CommitEditAsync(new EditTransactionRequest(workspaceId, transaction.TransactionId), TestContext.Current.CancellationToken);

		var body = await manager.GetMethodBodyAsync(new MethodBodyRequest(workspaceId, created.NodeId), TestContext.Current.CancellationToken);
		Assert.NotEmpty(body.Instructions);
	}

	[Fact]
	public async Task EditingARowWritesTheWholeModelOverItAndUndoRestoresWhatItHeld() {
		var workspaceId = await OpenContractsAssemblyAsync();
		var type = await FindTypeAsync(workspaceId, "dnSpy.Backend.Contracts.RpcException");
		var member = await FindMethodAsync(workspaceId, type.Id);
		var before = await manager.GetOptionsAsync(
			new GetNodeOptionsRequest(workspaceId, NodeOptionKinds.Method, member.Id),
			TestContext.Current.CancellationToken);

		var transaction = await manager.BeginEditAsync(new BeginEditRequest(workspaceId), TestContext.Current.CancellationToken);
		await manager.QueueSetOptionsAsync(
			new SetNodeOptionsRequest(workspaceId, transaction.TransactionId, member.Id, before with { Method = before.Method! with { Name = "Renamed" } }),
			TestContext.Current.CancellationToken);
		await manager.CommitEditAsync(new EditTransactionRequest(workspaceId, transaction.TransactionId), TestContext.Current.CancellationToken);

		var renamed = Assert.Single(await MembersAsync(workspaceId, type.Id), node => node.Id == member.Id);
		Assert.StartsWith("Renamed", renamed.Label, StringComparison.Ordinal);
		// The node itself is the same row throughout: an edit changes what a row says, not which row it is.
		var after = await manager.GetOptionsAsync(
			new GetNodeOptionsRequest(workspaceId, NodeOptionKinds.Method, member.Id),
			TestContext.Current.CancellationToken);
		Assert.Equal("Renamed", after.Method?.Name);
		Assert.Equal(before.Method?.MethodSig?.Display, after.Method?.MethodSig?.Display);

		await manager.UndoAsync(new WorkspaceRequest(workspaceId), TestContext.Current.CancellationToken);
		var restored = Assert.Single(await MembersAsync(workspaceId, type.Id), node => node.Id == member.Id);
		Assert.Equal(member.Label, restored.Label);
	}

	[Fact]
	public async Task ACreatedMethodIsInTheFileThatIsSavedAndReopened() {
		var workspaceId = await OpenContractsAssemblyAsync();
		var type = await FindTypeAsync(workspaceId, "dnSpy.Backend.Contracts.RpcException");
		var created = await CreateAsync(workspaceId, type.Id, await NewOptionsAsync(workspaceId, NodeOptionKinds.Method, type.Id));
		var moduleId = Assert.Single((await manager.GetRootsAsync(new WorkspaceRequest(workspaceId), TestContext.Current.CancellationToken)).Nodes).Id;

		var destination = Path.Combine(Path.GetTempPath(), $"dnspy-created-{Guid.NewGuid():N}.dll");
		try {
			await manager.SaveModuleAsync(new SaveModuleRequest(workspaceId, moduleId, destination), TestContext.Current.CancellationToken);

			var reopened = await manager.OpenAsync(new OpenWorkspaceRequest([destination]), TestContext.Current.CancellationToken);
			var results = await manager.SearchAsync(
				new SearchRequest(reopened.WorkspaceId, "MyMethod", ["method"]),
				TestContext.Current.CancellationToken);
			var found = Assert.Single(results.Results);
			Assert.Equal(created.Label, found.Name);
			Assert.Equal("dnSpy.Backend.Contracts.RpcException", found.Location);
		}
		finally {
			File.Delete(destination);
		}
	}

	[Fact]
	public async Task ACreationThatCannotBeAppliedIsRejectedBeforeAnythingIsBuilt() {
		var workspaceId = await OpenContractsAssemblyAsync();
		var module = Assert.Single((await manager.GetRootsAsync(new WorkspaceRequest(workspaceId), TestContext.Current.CancellationToken)).Nodes);
		var type = await FindTypeAsync(workspaceId, "dnSpy.Backend.Contracts.RpcException");
		var options = await NewOptionsAsync(workspaceId, NodeOptionKinds.Method, type.Id);
		var transaction = await manager.BeginEditAsync(new BeginEditRequest(workspaceId), TestContext.Current.CancellationToken);
		var before = await MembersAsync(workspaceId, type.Id);

		// A module holds types, not methods, so this owner cannot take the row the dialog offers.
		var exception = await Assert.ThrowsAsync<RpcException>(() => manager.QueueCreateAsync(
			new CreateNodeRequest(workspaceId, transaction.TransactionId, module.Id, options),
			TestContext.Current.CancellationToken));
		Assert.Equal(ErrorCodes.EditValidationFailed, exception.Code);

		await manager.RollbackEditAsync(new EditTransactionRequest(workspaceId, transaction.TransactionId), TestContext.Current.CancellationToken);
		Assert.Equal(before.Select(node => node.Id), (await MembersAsync(workspaceId, type.Id)).Select(node => node.Id));
	}

	[Fact]
	public async Task AnEditWithTheWrongKindOfOptionsIsRejected() {
		var workspaceId = await OpenContractsAssemblyAsync();
		var type = await FindTypeAsync(workspaceId, "dnSpy.Backend.Contracts.RpcException");
		var member = await FindMethodAsync(workspaceId, type.Id);
		var fieldOptions = await NewOptionsAsync(workspaceId, NodeOptionKinds.Field, type.Id);
		var transaction = await manager.BeginEditAsync(new BeginEditRequest(workspaceId), TestContext.Current.CancellationToken);

		var exception = await Assert.ThrowsAsync<RpcException>(() => manager.QueueSetOptionsAsync(
			new SetNodeOptionsRequest(workspaceId, transaction.TransactionId, member.Id, fieldOptions),
			TestContext.Current.CancellationToken));
		Assert.Equal(ErrorCodes.EditValidationFailed, exception.Code);
		await manager.RollbackEditAsync(new EditTransactionRequest(workspaceId, transaction.TransactionId), TestContext.Current.CancellationToken);
	}

	async Task<EditNodeResponse> CreateAsync(string workspaceId, string ownerNodeId, NodeOptionsDto options) {
		var transaction = await manager.BeginEditAsync(new BeginEditRequest(workspaceId), TestContext.Current.CancellationToken);
		var created = await manager.QueueCreateAsync(
			new CreateNodeRequest(workspaceId, transaction.TransactionId, ownerNodeId, options),
			TestContext.Current.CancellationToken);
		var committed = await manager.CommitEditAsync(new EditTransactionRequest(workspaceId, transaction.TransactionId), TestContext.Current.CancellationToken);
		// What the client reveals after a create is this id, so it has to be in the response the commit gives back.
		Assert.Contains(created.NodeId, committed.ChangedNodeIds);
		return created;
	}

	Task<NodeOptionsDto> NewOptionsAsync(string workspaceId, string kind, string ownerNodeId) => manager.GetOptionsAsync(
		new GetNodeOptionsRequest(workspaceId, kind, OwnerNodeId: ownerNodeId, IsNew: true),
		TestContext.Current.CancellationToken);

	async Task<IReadOnlyList<TreeNodeDto>> ChildrenAsync(string workspaceId, string nodeId) =>
		(await manager.GetChildrenAsync(new NodeRequest(workspaceId, nodeId), TestContext.Current.CancellationToken)).Nodes;

	Task<IReadOnlyList<TreeNodeDto>> MembersAsync(string workspaceId, string typeNodeId) => ChildrenAsync(workspaceId, typeNodeId);

	/// <summary>One method of the type, which is the `Code` property's getter in the fixture the tests use.</summary>
	async Task<TreeNodeDto> FindMethodAsync(string workspaceId, string typeNodeId) =>
		Assert.Single(await MembersAsync(workspaceId, typeNodeId), node => node.Label.StartsWith("get_Code", StringComparison.Ordinal));

	async Task<TreeNodeDto> FindTypeAsync(string workspaceId, string fullName) {
		var module = Assert.Single((await manager.GetRootsAsync(new WorkspaceRequest(workspaceId), TestContext.Current.CancellationToken)).Nodes);
		var @namespace = fullName[..fullName.LastIndexOf('.')];
		foreach (var node in await ChildrenAsync(workspaceId, module.Id)) {
			if (node.Kind != "namespace" || node.Label != @namespace)
				continue;
			return Assert.Single(await ChildrenAsync(workspaceId, node.Id), candidate => candidate.Label == fullName);
		}
		throw new InvalidOperationException($"The module has no namespace '{@namespace}'.");
	}

	async Task<TreeNodeDto> NamespaceOfAsync(string workspaceId, TreeNodeDto type) {
		var module = Assert.Single((await manager.GetRootsAsync(new WorkspaceRequest(workspaceId), TestContext.Current.CancellationToken)).Nodes);
		var @namespace = type.Label[..type.Label.LastIndexOf('.')];
		return Assert.Single(await ChildrenAsync(workspaceId, module.Id), node => node.Kind == "namespace" && node.Label == @namespace);
	}

	async Task<string> OpenContractsAssemblyAsync() {
		var opened = await manager.OpenAsync(
			new OpenWorkspaceRequest([typeof(HelloRequest).Assembly.Location]),
			TestContext.Current.CancellationToken);
		return opened.WorkspaceId;
	}

	public void Dispose() => manager.Dispose();
}
