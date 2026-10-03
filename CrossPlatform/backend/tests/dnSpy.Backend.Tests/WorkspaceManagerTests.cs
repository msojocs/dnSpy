using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using dnlib.DotNet;
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
		var mixed = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, getCode.Id, DecompilerLanguage.ILWithCSharp),
			TestContext.Current.CancellationToken);
		Assert.Equal("il", mixed.Language);
		Assert.Contains(".method", mixed.Text, StringComparison.Ordinal);
		Assert.Contains("IL_", mixed.Text, StringComparison.Ordinal);
		Assert.True(
			mixed.Text.IndexOf("//", StringComparison.Ordinal) < mixed.Text.IndexOf("IL_", StringComparison.Ordinal),
			$"Expected decompiled C# before the matching IL instructions:{Environment.NewLine}{mixed.Text}");
		var codeProperty = Assert.Single(rpcMembers.Nodes, member => member.Kind == "property" && member.Label == "Code");
		var mixedProperty = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, codeProperty.Id, DecompilerLanguage.ILWithCSharp),
			TestContext.Current.CancellationToken);
		Assert.Contains(".property", mixedProperty.Text, StringComparison.Ordinal);
		Assert.Contains(".method", mixedProperty.Text, StringComparison.Ordinal);
		Assert.Contains("//", mixedProperty.Text, StringComparison.Ordinal);
		var visualBasic = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, rpcException.Id, DecompilerLanguage.VisualBasic),
			TestContext.Current.CancellationToken);
		Assert.Equal("visual-basic", visualBasic.Language);
		Assert.Contains("Class RpcException", visualBasic.Text, StringComparison.OrdinalIgnoreCase);
	}

	[Fact]
	public async Task DecompileWholeModule_ProducesCodeStatements() {
		// The contracts assembly is nearly all primary-constructor records and constants, so almost none of it has
		// a body to map. The workspace manager's own module is the opposite: every one of its types is code.
		var opened = await manager.OpenAsync(
			new OpenWorkspaceRequest([typeof(WorkspaceManager).Assembly.Location]),
			TestContext.Current.CancellationToken);
		var roots = await manager.GetRootsAsync(new WorkspaceRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);
		var module = Assert.Single(roots.Nodes);

		var csharp = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, module.Id, DecompilerLanguage.CSharp),
			TestContext.Current.CancellationToken);

		var statements = Assert.IsAssignableFrom<IReadOnlyList<CodeStatementDto>>(csharp.CodeStatements);
		AssertStatementsLookSane(statements, csharp.Text);

		// The module document has to cover every body in it, not only the types the user happened to expand.
		var bodies = statements.Where(statement => !statement.IsHidden).Select(statement => statement.MetadataToken).Distinct().Count();
		Assert.True(bodies > 100, $"The whole-module statement map covers only {bodies} method bodies.");
		Assert.Contains(statements, statement => statement.Description.Contains("dnSpy.Backend.Core.WorkspaceManager::", StringComparison.Ordinal));

		// A breakpoint must land on the same IL offset whichever document it was set from, so the module map has
		// to agree with what the standalone method view of the same body reports.
		var type = await FindTypeAsync(opened.WorkspaceId, "dnSpy.Backend.Core", "dnSpy.Backend.Core.WorkspaceManager");
		var members = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, type.Id), TestContext.Current.CancellationToken);
		var moduleIdentities = statements.Where(statement => !statement.IsHidden).Select(statement => (statement.MetadataToken, statement.IlOffset)).ToHashSet();
		// Constructors are the one exception and are checked against a plain method instead: a field initializer
		// is written on the field, so the module document maps its IL to the field declaration while the method
		// document maps the same IL to the constructor body. Only the initializers' offsets line up between them.
		foreach (var member in members.Nodes.Where(node => node.Kind == "method" && !node.Label.StartsWith('.'))) {
			var view = await manager.DecompileAsync(
				new DecompileRequest(opened.WorkspaceId, member.Id, DecompilerLanguage.CSharp),
				TestContext.Current.CancellationToken);
			var body = (view.CodeStatements ?? []).Where(statement => !statement.IsHidden).ToArray();
			if (body.Length == 0)
				continue;
			Assert.All(body, statement => Assert.Contains((statement.MetadataToken, statement.IlOffset), moduleIdentities));
			// A plain method's IL lives in the token the user sees, not in a generated state machine.
			Assert.Equal(body[0].MetadataToken, body[0].SourceMethodToken);
			Assert.EndsWith(".dll", body[0].ModulePath, StringComparison.OrdinalIgnoreCase);
			return;
		}
		Assert.Fail("No method of the workspace manager produced a statement map.");
	}

	/// <summary>
	/// The offset a statement hands the engine has to be where that statement's own code starts. Tiling the
	/// method's IL charges every offset that belongs to no statement to the statement that follows it, which
	/// in a loop makes the <c>return</c> report the loop's own condition: a breakpoint set there runs the loop
	/// again instead of stopping on the line the user clicked. The debuggee ships a PDB, so the offsets it
	/// records can say whether the map is right.
	/// </summary>
	[Fact]
	public async Task CodeStatements_StartAtTheStatementsOwnCode() {
		var path = Path.Combine(AppContext.BaseDirectory, "DebugTarget.dll");
		Assert.True(File.Exists(path), $"The debuggee was not copied to the test output: {path}");
		using var module = ModuleDefMD.Load(path);
		var calculate = module.GetTypes().SelectMany(type => type.Methods).Single(method => method.Name == "Calculate");
		var token = unchecked((int)calculate.MDToken.Raw);

		var opened = await manager.OpenAsync(new OpenWorkspaceRequest([path]), TestContext.Current.CancellationToken);
		var program = await FindTypeAsync(opened.WorkspaceId, "DebugTarget", "DebugTarget.Program");
		var members = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, program.Id), TestContext.Current.CancellationToken);
		var calculateNode = Assert.Single(members.Nodes, node => node.Label.StartsWith("Calculate(", StringComparison.Ordinal));
		var document = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, calculateNode.Id, DecompilerLanguage.CSharp),
			TestContext.Current.CancellationToken);

		var statements = (document.CodeStatements ?? [])
			.Where(statement => !statement.IsHidden && statement.MetadataToken == token)
			.OrderBy(statement => statement.IlOffset)
			.ToArray();
		Assert.NotEmpty(statements);
		var points = ReadSequencePoints(Path.ChangeExtension(path, ".pdb"), calculate.MDToken.ToInt32());
		// Hidden points mark IL that belongs to no source line, and an offset between two points is one the
		// engine cannot bind, so no statement may start on either — the loop's flag at IL_0014 is not the
		// return's code, even though the tiling hands it over.
		Assert.All(statements, statement => Assert.Contains(points, point => !point.IsHidden && point.Offset == statement.IlOffset));

		// The return's own code is the load of the returned value and the copy the compiler makes of it; the
		// branch out of the method after that is the exit's, not the line's. Staying inside the point it
		// starts on says so, and a statement started on the loop's flag would have to reach past it.
		var returnStatement = Assert.Single(statements, statement => statement.StartLine == LineOf(document.Text, "return num;"));
		var index = points.FindIndex(point => point.Offset == returnStatement.IlOffset);
		Assert.True(index >= 0, $"No sequence point starts at IL_{returnStatement.IlOffset:X4}.");
		// A point ends where the next one starts, and the last one at the end of the method's IL.
		var last = calculate.Body.Instructions[^1];
		var end = index + 1 < points.Count ? points[index + 1].Offset : (int)last.Offset + last.GetSize();
		Assert.InRange(returnStatement.IlEndOffset, returnStatement.IlOffset + 1, end);
	}

	/// <summary>The PDB's sequence points for a method, in IL order.</summary>
	static List<SequencePoint> ReadSequencePoints(string pdbPath, int methodToken) {
		using var stream = File.OpenRead(pdbPath);
		using var provider = MetadataReaderProvider.FromPortablePdbStream(stream);
		var pdb = provider.GetMetadataReader();
		// PDB rows are numbered like the metadata rows they describe, so the method's row number keys them.
		var debug = pdb.GetMethodDebugInformation(MetadataTokens.MethodDebugInformationHandle(methodToken & 0x00FFFFFF));
		return debug.GetSequencePoints()
			.OrderBy(point => point.Offset)
			.ToList();
	}

	static int LineOf(string text, string needle) {
		var lines = text.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');
		for (var index = 0; index < lines.Length; index++) {
			if (lines[index].Contains(needle, StringComparison.Ordinal))
				return index + 1;
		}
		return 0;
	}

	[Fact]
	public async Task ResolveBreakpoints_SnapsToNearestStatement() {
		var opened = await OpenContractsAssemblyAsync();
		var rpcException = await FindTypeAsync(opened.WorkspaceId, "dnSpy.Backend.Contracts", "dnSpy.Backend.Contracts.RpcException");
		var csharp = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, rpcException.Id, DecompilerLanguage.CSharp),
			TestContext.Current.CancellationToken);
		var statements = Assert.IsAssignableFrom<IReadOnlyList<CodeStatementDto>>(csharp.CodeStatements);
		var first = statements.OrderBy(statement => statement.StartLine).ThenBy(statement => statement.StartColumn).First();
		// Line 1 is a using directive or the namespace header. The test needs that not to be a statement itself,
		// or it would be asserting the trivial case of a click landing exactly on a sequence point.
		Assert.True(first.StartLine > 1, $"Expected the first statement below line 1, found line {first.StartLine}.");
		Assert.DoesNotContain(statements, statement => statement.StartLine <= 1 && statement.EndLine >= 1);

		var response = await manager.ResolveBreakpointsAsync(
			opened.WorkspaceId,
			[new BreakpointQuery("on", rpcException.Id, first.StartLine), new BreakpointQuery("above", rpcException.Id, 1)],
			TestContext.Current.CancellationToken);

		var on = Assert.Single(response.Breakpoints, breakpoint => breakpoint.Id == "on");
		var above = Assert.Single(response.Breakpoints, breakpoint => breakpoint.Id == "above");
		Assert.True(on.Bound, on.Reason);
		Assert.True(above.Bound, above.Reason);
		// A click above every statement snaps down to the same sequence point the exact hit resolves to; the
		// snapped line travels back with it, which is what the editor echoes in the gutter.
		Assert.Equal(on.ModulePath, above.ModulePath);
		Assert.Equal(on.MetadataToken, above.MetadataToken);
		Assert.Equal(on.IlOffset, above.IlOffset);
		Assert.NotEqual(1, above.StartLine);
		Assert.Equal(first.StartLine, on.StartLine);
		Assert.Equal(on.StartLine, above.StartLine);
		Assert.Equal(on.StartColumn, above.StartColumn);
	}

	[Fact]
	public async Task ResolveBreakpoints_UnboundWhenNoSequencePoint() {
		// An interface method has no body and therefore no sequence points: its document renders, but nothing in
		// it maps to IL. The request has to come back unbound with a reason rather than inventing an offset.
		var opened = await OpenContractsAssemblyAsync();
		var resolver = await FindTypeAsync(opened.WorkspaceId, "dnSpy.Backend.Contracts", "dnSpy.Backend.Contracts.IDebugSymbolResolver");
		var members = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, resolver.Id), TestContext.Current.CancellationToken);
		var method = Assert.Single(members.Nodes, node => node.Label.StartsWith("FindMethods", StringComparison.Ordinal));

		var document = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, method.Id, DecompilerLanguage.CSharp),
			TestContext.Current.CancellationToken);
		Assert.Empty(document.CodeStatements ?? []);
		Assert.Contains("FindMethodsAsync", document.Text, StringComparison.Ordinal);

		var response = await manager.ResolveBreakpointsAsync(
			opened.WorkspaceId,
			[new BreakpointQuery("no-point", method.Id, 1)],
			TestContext.Current.CancellationToken);

		var breakpoint = Assert.Single(response.Breakpoints);
		Assert.False(breakpoint.Bound);
		Assert.False(string.IsNullOrWhiteSpace(breakpoint.Reason));
		Assert.Null(breakpoint.ModulePath);
		Assert.Null(breakpoint.MetadataToken);
		Assert.Null(breakpoint.IlOffset);
	}

	[Fact]
	public async Task ResolveIlLocation_RoundTrips() {
		var opened = await OpenContractsAssemblyAsync();
		var rpcException = await FindTypeAsync(opened.WorkspaceId, "dnSpy.Backend.Contracts", "dnSpy.Backend.Contracts.RpcException");
		var rpcMembers = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, rpcException.Id), TestContext.Current.CancellationToken);
		var getCodeNode = Assert.Single(rpcMembers.Nodes, member => member.Label == "get_Code()");

		// The statement table of a method document is decompiled from the method alone, so the line it reports is
		// the line the client will see once it opens that same method as a document.
		var document = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, getCodeNode.Id, DecompilerLanguage.CSharp),
			TestContext.Current.CancellationToken);
		var statement = Assert.Single(Assert.IsAssignableFrom<IReadOnlyList<CodeStatementDto>>(document.CodeStatements));

		var location = await manager.ResolveIlLocationAsync(
			opened.WorkspaceId,
			statement.ModulePath,
			statement.MetadataToken,
			statement.IlOffset,
			TestContext.Current.CancellationToken);

		Assert.NotNull(location);
		Assert.Equal(getCodeNode.Id, location.NodeId);
		Assert.False(location.IsExternalModule);
		Assert.Equal(statement.Description, location.Description);
		Assert.Equal(statement.StartLine, location.StartLine);
		Assert.Equal(statement.EndLine, location.EndLine);
		Assert.Equal(statement.StartColumn, location.StartColumn);
		Assert.Equal(statement.EndColumn, location.EndColumn);
		Assert.Equal(statement.IlOffset, location.IlOffset);
		Assert.Equal(statement.MetadataToken, location.MetadataToken);

		// An offset in the middle of the range belongs to the same statement, not only its first instruction.
		var inside = await manager.ResolveIlLocationAsync(
			opened.WorkspaceId,
			statement.ModulePath,
			statement.MetadataToken,
			statement.IlEndOffset - 1,
			TestContext.Current.CancellationToken);
		Assert.NotNull(inside);
		Assert.Equal(location.StartLine, inside.StartLine);
		Assert.Equal(location.IlOffset, inside.IlOffset);
	}

	[Fact]
	public async Task ResolveIlLocation_ExternalModule() {
		// A debuggee module is routinely not one the user opened, so a stopped IL location has to resolve from the
		// file on disk alone: the frame keeps its line, but there is no tree node to navigate to.
		var directory = Directory.CreateTempSubdirectory("dnspy-external-module-");
		try {
			var path = Path.Combine(directory.FullName, "ExternalContracts.dll");
			File.Copy(typeof(HelloRequest).Assembly.Location, path);
			var token = typeof(RpcException).GetProperty(nameof(RpcException.Code))!.GetGetMethod()!.MetadataToken;

			var location = await manager.ResolveIlLocationAsync(null, path, token, 0, TestContext.Current.CancellationToken);

			Assert.NotNull(location);
			Assert.True(location.IsExternalModule);
			Assert.Null(location.NodeId);
			Assert.Equal(path, location.ModulePath);
			Assert.Equal("System.Int32 dnSpy.Backend.Contracts.RpcException::get_Code()", location.Description);
			Assert.Equal(0, location.IlOffset);
			Assert.Equal(location.StartLine, location.EndLine);
			Assert.True(location.StartColumn > 0 && location.EndColumn > 0, $"Columns {location.StartColumn}-{location.EndColumn} are not positive.");
		}
		finally {
			directory.Delete(true);
		}
	}

	/// <summary>The <c>get_Code</c> statements, in IL order, of whichever document produced them.</summary>
	static List<CodeStatementDto> GetCodeStatements(IReadOnlyList<CodeStatementDto> statements) =>
		statements
			.Where(statement => statement.Description.Contains("::get_Code(", StringComparison.Ordinal))
			.OrderBy(statement => statement.IlOffset)
			.ToList();

	static void AssertStatementsLookSane(IReadOnlyList<CodeStatementDto> statements, string text) {
		Assert.NotEmpty(statements);
		var lineCount = text.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n').Length;
		foreach (var statement in statements) {
			if (statement.IsHidden) {
				// A hidden sequence point has no line, and ILSpy marks that with the PDB-wide 0xFEEFEE sentinel.
				// Nothing may draw it or snap a click onto it, so out-of-range line numbers are expected here.
				Assert.Equal(0xFEEFEE, statement.StartLine);
				continue;
			}
			Assert.True(statement.StartLine <= statement.EndLine, $"Line range {statement.StartLine}-{statement.EndLine} is inverted.");
			Assert.InRange(statement.StartLine, 1, lineCount);
			Assert.InRange(statement.EndLine, 1, lineCount);
			Assert.True(statement.StartColumn > 0 && statement.EndColumn > 0, $"Columns {statement.StartColumn}-{statement.EndColumn} are not positive.");
			Assert.True(statement.IlEndOffset > statement.IlOffset, $"IL range {statement.IlOffset}-{statement.IlEndOffset} is empty.");
			Assert.NotEqual(0, statement.MetadataToken);
			Assert.NotEqual(0, statement.SourceMethodToken);
			Assert.EndsWith(".dll", statement.ModulePath, StringComparison.OrdinalIgnoreCase);
		}
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
		var mixed = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, getCode.Id, DecompilerLanguage.ILWithCSharp),
			TestContext.Current.CancellationToken);
		Assert.True(
			mixed.Text.Split('\n').Any(line => line.TrimStart().StartsWith("//", StringComparison.Ordinal) && line.Contains("42", StringComparison.Ordinal)),
			$"Expected the updated constant in a C# source comment:{Environment.NewLine}{mixed.Text}");
		Assert.Contains("ldc.i4", mixed.Text, StringComparison.Ordinal);
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
	public async Task DeletesATypeAndUndoHandsBackTheSameNode() {
		var opened = await OpenContractsAssemblyAsync();
		var @namespace = await FindNamespaceAsync(opened.WorkspaceId, "dnSpy.Backend.Contracts");
		var helloRequest = await FindTypeAsync(opened.WorkspaceId, "dnSpy.Backend.Contracts", "dnSpy.Backend.Contracts.HelloRequest");
		var transaction = await manager.BeginEditAsync(new BeginEditRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);

		await manager.QueueDeleteAsync(
			new DeleteEditRequest(opened.WorkspaceId, transaction.TransactionId, helloRequest.Id),
			TestContext.Current.CancellationToken);
		var committed = await manager.CommitEditAsync(
			new EditTransactionRequest(opened.WorkspaceId, transaction.TransactionId),
			TestContext.Current.CancellationToken);
		Assert.Contains(helloRequest.Id, committed.ChangedNodeIds);

		var removed = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, @namespace.Id), TestContext.Current.CancellationToken);
		Assert.DoesNotContain(removed.Nodes, node => node.Label == "dnSpy.Backend.Contracts.HelloRequest");

		await manager.UndoAsync(new WorkspaceRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);

		// The node id is derived from the metadata token, so undo reinserts the very node the tree had.
		var restored = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, @namespace.Id), TestContext.Current.CancellationToken);
		Assert.Contains(restored.Nodes, node => node.Id == helloRequest.Id);
	}

	[Fact]
	public async Task DeletesAPropertyTogetherWithItsAccessors() {
		var opened = await OpenContractsAssemblyAsync();
		var rpcException = await FindTypeAsync(opened.WorkspaceId, "dnSpy.Backend.Contracts", "dnSpy.Backend.Contracts.RpcException");
		var members = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, rpcException.Id), TestContext.Current.CancellationToken);
		var code = Assert.Single(members.Nodes, node => node.Kind == "property" && node.Label == "Code");
		var transaction = await manager.BeginEditAsync(new BeginEditRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);

		await manager.QueueDeleteAsync(
			new DeleteEditRequest(opened.WorkspaceId, transaction.TransactionId, code.Id),
			TestContext.Current.CancellationToken);
		await manager.CommitEditAsync(
			new EditTransactionRequest(opened.WorkspaceId, transaction.TransactionId),
			TestContext.Current.CancellationToken);

		var remaining = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, rpcException.Id), TestContext.Current.CancellationToken);
		Assert.DoesNotContain(remaining.Nodes, node => node.Label == "Code");
		// dnSpy drops a property's accessor methods along with it, so the tree must not keep listing them.
		Assert.DoesNotContain(remaining.Nodes, node => node.Label.StartsWith("get_Code", StringComparison.Ordinal));
	}

	[Fact]
	public async Task RenamesANamespaceAndUndoPutsTheTypesBack() {
		var opened = await OpenContractsAssemblyAsync();
		var module = await FindModuleAsync(opened.WorkspaceId);
		var @namespace = await FindNamespaceAsync(opened.WorkspaceId, "dnSpy.Backend.Contracts");
		var transaction = await manager.BeginEditAsync(new BeginEditRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);

		await manager.QueueSetNamespaceAsync(
			new SetNamespaceEditRequest(opened.WorkspaceId, transaction.TransactionId, @namespace.Id, "dnSpy.Backend.Renamed"),
			TestContext.Current.CancellationToken);
		await manager.CommitEditAsync(
			new EditTransactionRequest(opened.WorkspaceId, transaction.TransactionId),
			TestContext.Current.CancellationToken);

		var children = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, module.Id), TestContext.Current.CancellationToken);
		Assert.DoesNotContain(children.Nodes, node => node.Label == "dnSpy.Backend.Contracts");
		var renamed = Assert.Single(children.Nodes, node => node.Label == "dnSpy.Backend.Renamed");
		var types = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, renamed.Id), TestContext.Current.CancellationToken);
		Assert.Contains(types.Nodes, node => node.Label == "dnSpy.Backend.Renamed.HelloRequest");

		await manager.UndoAsync(new WorkspaceRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);

		var restored = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, module.Id), TestContext.Current.CancellationToken);
		Assert.DoesNotContain(restored.Nodes, node => node.Label == "dnSpy.Backend.Renamed");
		var original = Assert.Single(restored.Nodes, node => node.Label == "dnSpy.Backend.Contracts");
		var originalTypes = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, original.Id), TestContext.Current.CancellationToken);
		Assert.Contains(originalTypes.Nodes, node => node.Label == "dnSpy.Backend.Contracts.HelloRequest");
	}

	[Fact]
	public async Task MovesANamespaceIntoTheEmptyOneAndDeletesItAsANoOp() {
		var opened = await OpenContractsAssemblyAsync();
		var module = await FindModuleAsync(opened.WorkspaceId);
		var @namespace = await FindNamespaceAsync(opened.WorkspaceId, "dnSpy.Backend.Contracts");
		var first = await manager.BeginEditAsync(new BeginEditRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);

		// An empty new name is dnSpy's "Move Types to Empty Namespace".
		await manager.QueueSetNamespaceAsync(
			new SetNamespaceEditRequest(opened.WorkspaceId, first.TransactionId, @namespace.Id, string.Empty),
			TestContext.Current.CancellationToken);
		await manager.CommitEditAsync(
			new EditTransactionRequest(opened.WorkspaceId, first.TransactionId),
			TestContext.Current.CancellationToken);

		var children = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, module.Id), TestContext.Current.CancellationToken);
		Assert.DoesNotContain(children.Nodes, node => node.Label == "dnSpy.Backend.Contracts");
		var unnamed = Assert.Single(children.Nodes, node => node.Label == "-");
		var types = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, unnamed.Id), TestContext.Current.CancellationToken);
		Assert.Contains(types.Nodes, node => node.Label == "HelloRequest");

		// Deleting the namespace it left behind removes its types, of which there are now none — dnSpy's
		// delete-namespace command accepts that rather than failing on the empty list.
		var second = await manager.BeginEditAsync(new BeginEditRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);
		await manager.QueueDeleteAsync(
			new DeleteEditRequest(opened.WorkspaceId, second.TransactionId, @namespace.Id),
			TestContext.Current.CancellationToken);
		await manager.CommitEditAsync(
			new EditTransactionRequest(opened.WorkspaceId, second.TransactionId),
			TestContext.Current.CancellationToken);

		var afterDelete = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, module.Id), TestContext.Current.CancellationToken);
		Assert.Contains(afterDelete.Nodes, node => node.Label == "-");
	}

	[Fact]
	public async Task ReplacesAMethodBodyWithTheGeneratedStub() {
		var opened = await OpenContractsAssemblyAsync();
		var rpcException = await FindTypeAsync(opened.WorkspaceId, "dnSpy.Backend.Contracts", "dnSpy.Backend.Contracts.RpcException");
		var members = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, rpcException.Id), TestContext.Current.CancellationToken);
		var getCode = Assert.Single(members.Nodes, node => node.Label == "get_Code()");
		var before = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, getCode.Id, DecompilerLanguage.IL),
			TestContext.Current.CancellationToken);
		Assert.Contains("ldfld", before.Text, StringComparison.Ordinal);
		var transaction = await manager.BeginEditAsync(new BeginEditRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);

		await manager.QueueMethodBodyStubAsync(
			new ReplaceMethodBodyWithStubRequest(opened.WorkspaceId, transaction.TransactionId, getCode.Id),
			TestContext.Current.CancellationToken);
		await manager.CommitEditAsync(
			new EditTransactionRequest(opened.WorkspaceId, transaction.TransactionId),
			TestContext.Current.CancellationToken);

		// The stub is built from the method's own signature: for an int getter that is the default value,
		// so the field read is gone and the body still returns.
		var after = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, getCode.Id, DecompilerLanguage.IL),
			TestContext.Current.CancellationToken);
		Assert.DoesNotContain("ldfld", after.Text, StringComparison.Ordinal);
		Assert.Contains("ret", after.Text, StringComparison.Ordinal);
		var csharp = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, getCode.Id, DecompilerLanguage.CSharp),
			TestContext.Current.CancellationToken);
		Assert.Contains("return", csharp.Text, StringComparison.Ordinal);

		await manager.UndoAsync(new WorkspaceRequest(opened.WorkspaceId), TestContext.Current.CancellationToken);
		var undone = await manager.DecompileAsync(
			new DecompileRequest(opened.WorkspaceId, getCode.Id, DecompilerLanguage.IL),
			TestContext.Current.CancellationToken);
		Assert.Contains("ldfld", undone.Text, StringComparison.Ordinal);
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

	/// <summary>
	/// The engine has no symbol store to read a debuggee's locals from, so the names it shows come
	/// from the decompiler and are matched to ICorDebug slots by index.
	/// </summary>
	[Fact]
	public async Task GetVariableNames_NamesTheArgumentsAndLocalsOfAMethodBody() {
		var path = Path.Combine(AppContext.BaseDirectory, "DebugTarget.dll");
		Assert.True(File.Exists(path), $"The debuggee was not copied to the test output: {path}");
		using var module = ModuleDefMD.Load(path);
		var calculate = module.GetTypes()
			.SelectMany(type => type.Methods)
			.Single(method => method.Name == "Calculate");

		var names = await manager.GetVariableNamesAsync(null, path, unchecked((int)calculate.MDToken.Raw), TestContext.Current.CancellationToken);

		// `left` and `right` are the parameters, `sum` and `i` the locals: arguments first, then slots.
		// The locals are named from the PDB beside the assembly — the metadata holds no names for them.
		Assert.Equal(["left", "right", "sum", "i"], names.Select(name => name.Name));
		Assert.Equal([true, true, false, false], names.Select(name => name.IsArgument));
		Assert.Equal([0, 1, 0, 1], names.Select(name => name.Index));
		Assert.All(names, name => Assert.Contains("Int32", name.TypeName, StringComparison.Ordinal));
	}

	/// <summary>
	/// A debuggee built without symbols still has to answer: the arguments keep their metadata names
	/// and each local keeps a slot to match, so the Locals window shows values even without a PDB.
	/// </summary>
	[Fact]
	public async Task GetVariableNames_StillAnswersWithoutAPdbBesideTheModule() {
		var directory = Directory.CreateTempSubdirectory("dnspy-nopdb-");
		try {
			var source = Path.Combine(AppContext.BaseDirectory, "DebugTarget.dll");
			var path = Path.Combine(directory.FullName, "DebugTarget.dll");
			File.Copy(source, path);
			using var module = ModuleDefMD.Load(path);
			var calculate = module.GetTypes()
				.SelectMany(type => type.Methods)
				.Single(method => method.Name == "Calculate");

			var names = await manager.GetVariableNamesAsync(null, path, unchecked((int)calculate.MDToken.Raw), TestContext.Current.CancellationToken);

			Assert.Equal(4, names.Count);
			Assert.Equal(["left", "right"], names.Take(2).Select(name => name.Name));
			Assert.All(names, name => Assert.False(string.IsNullOrEmpty(name.Name)));
		}
		finally {
			directory.Delete(recursive: true);
		}
	}

	/// <summary>A method without a body has no slots, so it answers with nothing rather than failing.</summary>
	[Fact]
	public async Task GetVariableNames_IsEmptyForAMethodWithoutABody() {
		var opened = await OpenContractsAssemblyAsync();
		var method = typeof(IDebugSymbolResolver).GetMethod(nameof(IDebugSymbolResolver.FindMethodsAsync))!;

		var names = await manager.GetVariableNamesAsync(opened.WorkspaceId, typeof(IDebugSymbolResolver).Assembly.Location, method.MetadataToken, TestContext.Current.CancellationToken);

		Assert.Empty(names);
	}

	/// <summary>
	/// A step is nothing but a set of breakpoints on the statements it may land on, so the resolver has to
	/// hand back every statement of the body that is not on the line the thread stopped on: the runtime
	/// reports whichever of them the thread reaches first, and only it knows the order a loop runs in.
	/// The statements left out are the ones that could not move the client's stopped marker.
	/// </summary>
	[Fact]
	public async Task GetSteppingTargets_AreTheStatementsTheStepMayLandOn() {
		var path = Path.Combine(AppContext.BaseDirectory, "DebugTarget.dll");
		Assert.True(File.Exists(path), $"The debuggee was not copied to the test output: {path}");
		using var module = ModuleDefMD.Load(path);
		var calculate = module.GetTypes()
			.SelectMany(type => type.Methods)
			.Single(method => method.Name == "Calculate");
		var token = unchecked((int)calculate.MDToken.Raw);
		// The loop body is `sum += left;` and the header is the `for` it runs under, offsets read from the
		// PDB: the step is asked from the body, the way a breakpoint in the loop asks for it.
		var loopBody = SourceOffset(calculate, line: 26);
		var loopHeader = SourceOffset(calculate, line: 25);

		var response = await manager.GetSteppingTargetsAsync(null, path, token, loopBody, stepInto: false, TestContext.Current.CancellationToken);

		Assert.NotNull(response);
		Assert.NotEmpty(response.Targets);
		Assert.All(response.Targets, target => Assert.Equal(token, target.MetadataToken));
		var offsets = response.Targets.Select(target => target.IlOffset).ToArray();
		Assert.Equal(offsets.OrderBy(offset => offset).ToArray(), offsets);
		Assert.Equal(offsets.Length, offsets.Distinct().Count());
		// A statement on the line the thread is stopped on would report a stop that moves nothing, while
		// the header is armed even though it is behind the body: the loop reaches the body from it.
		Assert.DoesNotContain(loopBody, offsets);
		Assert.Contains(loopHeader, offsets);
		// The loop has statements to run again, so the step stays inside the method.
		Assert.False(response.LeavesMethod);
	}

	/// <summary>The offset a source line's first instruction was compiled to, read from the PDB.</summary>
	static int SourceOffset(MethodDef method, int line) {
		var points = ReadSequencePoints(Path.ChangeExtension(method.Module.Location, ".pdb"), method.MDToken.ToInt32());
		return points.First(point => !point.IsHidden && point.StartLine == line).Offset;
	}

	/// <summary>
	/// "Step into" has to add the first statement of the method the current instruction calls —
	/// without it there is no breakpoint inside the callee, so the step could only overshoot it.
	/// </summary>
	[Fact]
	public async Task GetSteppingTargets_SteppingIntoACallAlsoTargetsTheCallee() {
		var path = Path.Combine(AppContext.BaseDirectory, "DebugTarget.dll");
		Assert.True(File.Exists(path), $"The debuggee was not copied to the test output: {path}");
		using var module = ModuleDefMD.Load(path);
		var program = module.GetTypes().Single(type => type.Name == "Program");
		var main = program.Methods.Single(method => method.Name == "Main");
		var calculate = program.Methods.Single(method => method.Name == "Calculate");
		var mainToken = unchecked((int)main.MDToken.Raw);
		var calculateToken = unchecked((int)calculate.MDToken.Raw);
		var call = main.Body.Instructions.Single(instruction => instruction.Operand is MethodDef callee && callee.Name == "Calculate");

		var into = await manager.GetSteppingTargetsAsync(null, path, mainToken, (int)call.Offset, stepInto: true, TestContext.Current.CancellationToken);
		var over = await manager.GetSteppingTargetsAsync(null, path, mainToken, (int)call.Offset, stepInto: false, TestContext.Current.CancellationToken);
		// Asking from an offset before the method starts yields every statement, so the first one is
		// whatever the resolver considers the callee's entry — no need to hard-code an IL offset.
		var calleeStatements = await manager.GetSteppingTargetsAsync(null, path, calculateToken, -1, stepInto: false, TestContext.Current.CancellationToken);

		Assert.NotNull(into);
		Assert.NotNull(over);
		Assert.NotNull(calleeStatements);
		Assert.NotEmpty(calleeStatements.Targets);
		// Every statement of the callee is armed: the runtime stops at the first one the call runs.
		Assert.Contains(calleeStatements.Targets[0], into.Targets);
		Assert.DoesNotContain(over.Targets, target => target.MetadataToken == calculateToken);
		// The call is the last statement of `Main`, yet the callee does run, so the step goes into it
		// rather than out of the method.
		Assert.False(into.LeavesMethod);

		// A stop is on a statement's first instruction, and the call site pushes its arguments first, so
		// the call is not at the location a step starts from. The step still has to find it: the frame of
		// a breakpoint on the calling statement is the one a "step into" is asked from.
		var points = ReadSequencePoints(Path.ChangeExtension(main.Module.Location, ".pdb"), main.MDToken.ToInt32());
		var statementStart = points.Where(point => !point.IsHidden && point.Offset <= call.Offset).Max(point => point.Offset);
		Assert.True(statementStart < call.Offset, "The call is the first instruction of its statement, so the test covers nothing.");
		var fromStatementStart = await manager.GetSteppingTargetsAsync(null, path, mainToken, statementStart, stepInto: true, TestContext.Current.CancellationToken);

		Assert.NotNull(fromStatementStart);
		Assert.Contains(calleeStatements.Targets[0], fromStatementStart.Targets);
		Assert.False(fromStatementStart.LeavesMethod);
	}

	/// <summary>
	/// The end of a body is where a step has to leave the method: no statement of it can run again, so the
	/// engine asks the runtime to step out and the stop is reported in the caller.
	/// </summary>
	[Fact]
	public async Task GetSteppingTargets_LeaveTheMethodAfterItsLastStatement() {
		var path = Path.Combine(AppContext.BaseDirectory, "DebugTarget.dll");
		Assert.True(File.Exists(path), $"The debuggee was not copied to the test output: {path}");
		using var module = ModuleDefMD.Load(path);
		var calculate = module.GetTypes()
			.SelectMany(type => type.Methods)
			.Single(method => method.Name == "Calculate");
		var last = calculate.Body.Instructions[^1];
		var end = (int)last.Offset + last.GetSize();
		// The last statement is the `return`, which the step must not land on again. The body's other
		// statements are still armed — a loop runs its body again, and which pass the thread is on is
		// not something a step can know from the IL — so the assertion is about the return alone.
		var returnOffset = SourceOffset(calculate, line: 28);

		var response = await manager.GetSteppingTargetsAsync(null, path, unchecked((int)calculate.MDToken.Raw), end, stepInto: false, TestContext.Current.CancellationToken);

		Assert.NotNull(response);
		Assert.True(response.LeavesMethod);
		Assert.DoesNotContain(returnOffset, response.Targets.Select(target => target.IlOffset));
	}

	/// <summary>
	/// An async method's IL is the state machine's <c>MoveNext</c>, and the compiler charges the code that
	/// copies an argument into the machine to the statement that follows it — so a statement's own start is
	/// not an offset the runtime will accept a breakpoint on. The sequence point is, and both are answered so
	/// a click still binds while the statement keeps its own identity.
	/// </summary>
	[Fact]
	public async Task ResolveBreakpoints_NamesTheOffsetAStateMachineWillAccept() {
		var (path, opened, node, document) = await OpenMethodDocumentAsync("AddAsync(");
		var sum = Assert.Single(
			document.CodeStatements ?? [],
			statement => statement.StartLine == LineOf(document.Text, "int sum = left + right;"));

		// The body's offsets belong to the generated MoveNext, which is not the method the user wrote.
		using var module = ModuleDefMD.Load(path);
		var addAsync = module.GetTypes().SelectMany(type => type.Methods).Single(method => method.Name == "AddAsync");
		Assert.NotEqual(unchecked((int)addAsync.MDToken.Raw), sum.MetadataToken);
		// The premise of the test: the statement starts inside the point that covers it. If the compiler
		// ever stops doing that, the case is no longer covered and the assertion below would be false.
		Assert.NotEqual(sum.SequencePointIlOffset, sum.IlOffset);

		var response = await manager.ResolveBreakpointsAsync(opened.WorkspaceId, [new BreakpointQuery("sum", node.Id, sum.StartLine)], TestContext.Current.CancellationToken);

		var breakpoint = Assert.Single(response.Breakpoints);
		Assert.True(breakpoint.Bound, breakpoint.Reason);
		Assert.Equal(sum.MetadataToken, breakpoint.MetadataToken);
		Assert.Equal(sum.IlOffset, breakpoint.IlOffset);
		Assert.Equal(sum.SequencePointIlOffset, breakpoint.SequencePointIlOffset);
	}

	/// <summary>
	/// Stepping through a state machine needs both offsets of every statement it may land on: the runtime
	/// refuses the statement's own start wherever the point that covers it begins earlier, and it is the
	/// statement's own start that says which line a stop belongs to. Arming only one of them leaves either
	/// the step unable to land or the line it reports wrong.
	/// </summary>
	[Fact]
	public async Task GetSteppingTargets_ArmsTheOffsetsAStateMachineWillAccept() {
		var (path, opened, _, document) = await OpenMethodDocumentAsync("AddAsync(");
		var statements = (document.CodeStatements ?? []).Where(statement => !statement.IsHidden).ToArray();
		var sum = Assert.Single(statements, statement => statement.StartLine == LineOf(document.Text, "int sum = left + right;"));
		var wait = Assert.Single(statements, statement => statement.StartLine == LineOf(document.Text, "await Task.Yield();"));
		var ret = Assert.Single(statements, statement => statement.StartLine == LineOf(document.Text, "return sum;"));

		// A breakpoint on the statement stops where the runtime accepts the breakpoint, which is the point.
		var response = await manager.GetSteppingTargetsAsync(opened.WorkspaceId, path, sum.MetadataToken, sum.SequencePointIlOffset, stepInto: false, TestContext.Current.CancellationToken);

		var targets = Assert.IsAssignableFrom<IReadOnlyList<SteppingTarget>>(response?.Targets);
		var offsets = targets.Select(target => target.IlOffset).ToArray();
		Assert.All(targets, target => Assert.Equal(sum.MetadataToken, target.MetadataToken));
		// The statement the step starts from is not armed again: stopping there moves no marker.
		Assert.DoesNotContain(sum.IlOffset, offsets);
		Assert.DoesNotContain(sum.SequencePointIlOffset, offsets);
		// What it can reach is armed at the offset the runtime accepts and at the statement's own start.
		Assert.Contains(wait.IlOffset, offsets);
		Assert.Contains(ret.SequencePointIlOffset, offsets);
		Assert.Contains(ret.IlOffset, offsets);
		// The suspension is inside the method, so the step stays in it.
		Assert.False(response!.LeavesMethod);
	}

	/// <summary>
	/// A point whose leading IL branches belongs to the statement before it — a loop's condition tail,
	/// which the tiling charges to whatever follows — and the runtime accepts a breakpoint there. It is
	/// not offered as a fallback: the thread would stop inside the loop's condition on every pass while
	/// the client reported the line after it.
	/// </summary>
	[Fact]
	public async Task ResolveBreakpoints_RefusesAPointThatBranchesAwayFromItsStatement() {
		var (path, opened, node, document) = await OpenMethodDocumentAsync("Calculate(");
		var statements = (document.CodeStatements ?? []).Where(statement => !statement.IsHidden).ToArray();
		var body = Assert.Single(statements, statement => statement.StartLine == LineOf(document.Text, "+="));
		var ret = Assert.Single(statements, statement => statement.StartLine == LineOf(document.Text, "return "));
		// The premise: the tiling starts the return's point on the loop's own condition tail.
		Assert.True(ret.SequencePointIlOffset < ret.IlOffset, "The tiling no longer charges the loop's tail to the return.");

		var response = await manager.ResolveBreakpointsAsync(opened.WorkspaceId, [new BreakpointQuery("ret", node.Id, ret.StartLine)], TestContext.Current.CancellationToken);

		var breakpoint = Assert.Single(response.Breakpoints);
		Assert.True(breakpoint.Bound, breakpoint.Reason);
		Assert.Equal(ret.IlOffset, breakpoint.IlOffset);
		Assert.Null(breakpoint.SequencePointIlOffset);

		// A step run from the loop's body arms the return, since the loop can reach it — but only at the
		// offset the statement's own code starts at.
		var targets = await manager.GetSteppingTargetsAsync(opened.WorkspaceId, path, ret.MetadataToken, body.IlOffset, stepInto: false, TestContext.Current.CancellationToken);

		Assert.NotNull(targets);
		var offsets = targets.Targets.Select(target => target.IlOffset).ToArray();
		Assert.Contains(ret.IlOffset, offsets);
		Assert.DoesNotContain(ret.SequencePointIlOffset, offsets);
	}

	/// <summary>
	/// A bookmark is saved as module path plus metadata token, because node ids only live as long as the
	/// workspace that minted them. Resolving it back is what makes a bookmark survive a restart.
	/// </summary>
	[Fact]
	public async Task FindMember_ResolvesAPersistedBookmarkBackToItsNode() {
		var (_, opened, node, document) = await OpenMethodDocumentAsync("AddAsync(");
		var sum = Assert.Single(document.CodeStatements ?? [], statement => statement.StartLine == LineOf(document.Text, "int sum = left + right;"));

		var found = await manager.FindMemberAsync(
			new FindMemberRequest(opened.WorkspaceId, sum.ModulePath, sum.SourceMethodToken),
			TestContext.Current.CancellationToken);

		Assert.Equal(node.Id, found.NodeId);
		Assert.Equal(node.Label, found.Label);
		Assert.False(string.IsNullOrWhiteSpace(found.Description));

		// The token the IL itself is named by belongs to the generated MoveNext. Resolving that would take
		// the user somewhere they never wrote, which is why the source token is the one that gets saved.
		var moveNext = await manager.FindMemberAsync(
			new FindMemberRequest(opened.WorkspaceId, sum.ModulePath, sum.MetadataToken),
			TestContext.Current.CancellationToken);

		Assert.NotNull(moveNext.NodeId);
		Assert.NotEqual(node.Id, moveNext.NodeId);
		Assert.Contains("MoveNext", moveNext.Label!, StringComparison.Ordinal);
	}

	[Fact]
	public async Task FindMember_AnswersNothingForWhatItCannotResolve() {
		var opened = await OpenContractsAssemblyAsync();
		var path = opened.Modules[0].Path;

		async Task<FindMemberResponse> Find(string modulePath, int metadataToken) => await manager.FindMemberAsync(
			new FindMemberRequest(opened.WorkspaceId, modulePath, metadataToken),
			TestContext.Current.CancellationToken);

		// A module this workspace never opened, a token its assembly does not contain, and no token at all.
		var missing = Path.Combine(Path.GetDirectoryName(path)!, "Missing.dll");
		Assert.Null((await Find(missing, 0x06000001)).NodeId);
		Assert.Null((await Find(path, 0x0600FFFF)).NodeId);
		Assert.Null((await Find(path, 0)).NodeId);
	}

	/// <summary>Opens the debuggee and decompiles one of its method nodes, for the state machine tests.</summary>
	async Task<(string Path, OpenWorkspaceResponse Opened, TreeNodeDto Node, DecompileResponse Document)> OpenMethodDocumentAsync(string memberLabel) {
		var path = Path.Combine(AppContext.BaseDirectory, "DebugTarget.dll");
		Assert.True(File.Exists(path), $"The debuggee was not copied to the test output: {path}");
		var opened = await manager.OpenAsync(new OpenWorkspaceRequest([path]), TestContext.Current.CancellationToken);
		var program = await FindTypeAsync(opened.WorkspaceId, "DebugTarget", "DebugTarget.Program");
		var members = await manager.GetChildrenAsync(new NodeRequest(opened.WorkspaceId, program.Id), TestContext.Current.CancellationToken);
		var node = Assert.Single(members.Nodes, member => member.Label.StartsWith(memberLabel, StringComparison.Ordinal));
		var document = await manager.DecompileAsync(new DecompileRequest(opened.WorkspaceId, node.Id, DecompilerLanguage.CSharp), TestContext.Current.CancellationToken);
		return (path, opened, node, document);
	}

	async Task<TreeNodeDto> FindModuleAsync(string workspaceId) => Assert.Single(
		(await manager.GetRootsAsync(new WorkspaceRequest(workspaceId), TestContext.Current.CancellationToken)).Nodes);

	async Task<TreeNodeDto> FindNamespaceAsync(string workspaceId, string namespaceName) {
		var root = await FindModuleAsync(workspaceId);
		var rootChildren = await manager.GetChildrenAsync(new NodeRequest(workspaceId, root.Id), TestContext.Current.CancellationToken);
		return Assert.Single(rootChildren.Nodes, node => node.Label == namespaceName);
	}

	async Task<TreeNodeDto> FindTypeAsync(string workspaceId, string namespaceName, string typeName) {
		var @namespace = await FindNamespaceAsync(workspaceId, namespaceName);
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
