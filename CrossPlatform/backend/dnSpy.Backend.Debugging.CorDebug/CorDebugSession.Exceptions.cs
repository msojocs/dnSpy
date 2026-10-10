using ICorDebugSharp;
using ICorDebugSharp.Extensions;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// Exception stops: deciding whether a thrown exception is one the user asked to break on, and
/// naming it for the client.
/// </summary>
/// <remarks>
/// The runtime reports the exception object, not its type name, and this engine has no symbols beside
/// a module — so the name is read back out of the module's own metadata (<see cref="IMetaDataImport"/>),
/// which the runtime does hand over. Nothing here needs the decompiler, so the decision and the stop
/// happen synchronously on the dispatcher; there is no separate resume to defer.
/// </remarks>
internal sealed partial class CorDebugSession {
	partial void OnExceptionThrown(Exception2CorDebugManagedCallbackEventArgs exception) {
		// Only the two moments the user can act on are stop points: when the exception is thrown and
		// when it has provably gone unhandled. CATCH_HANDLER_FOUND is the engine saying a handler is
		// about to run, which is not a place to break.
		var unhandled = exception.DwEventType == CorDebugExceptionCallbackType.DEBUG_EXCEPTION_UNHANDLED;
		if (!unhandled && exception.DwEventType is not (CorDebugExceptionCallbackType.DEBUG_EXCEPTION_FIRST_CHANCE or CorDebugExceptionCallbackType.DEBUG_EXCEPTION_USER_FIRST_CHANCE))
			return;
		if (ExceptionSettings is null)
			return;
		var thread = exception.Thread;
		if (thread is null)
			return;

		var (typeName, moduleName) = ResolveExceptionType(thread);
		if (typeName is null)
			return;
		// Every CoreCLR exception belongs to the DotNet category; the engine raises nothing for MDA.
		if (!ExceptionSettings.ShouldStop(ExceptionSettingsService.DotNetCategory, typeName, unhandled, moduleName))
			return;
		Stop(StopReasons.Exception, thread, null, new Dictionary<string, object?>(StringComparer.Ordinal) {
			["exceptionName"] = typeName,
			["exceptionModule"] = moduleName,
			["unhandled"] = unhandled,
		});
	}

	/// <summary>The thrown type's full name and its module's file name, or nulls when the runtime will not name it.</summary>
	(string? TypeName, string? ModuleName) ResolveExceptionType(ICorDebugThread thread) {
		try {
			var value = thread.CurrentException;
			// The thread reports the exception as a reference; walk it to the object it points at.
			while (value is ICorDebugReferenceValue reference) {
				if (reference.IsNull)
					return (null, null);
				var target = reference.Dereference();
				if (target is null)
					return (null, null);
				value = target;
			}
			if (value is not ICorDebugObjectValue objectValue)
				return (null, null);
			var type = objectValue.Class;
			var module = type.Module;
			if (module is null)
				return (null, null);
			return (ReadTypeName(module, type.Token), Path.GetFileName(module.Name));
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex) || ex is ArgumentException) {
			// A value the runtime has already collected, or a module with no metadata to read.
			return (null, null);
		}
	}

	/// <summary>
	/// The metadata name of a type, nested types spelled as the definition files spell them
	/// (<c>Ns.Outer+Inner</c>). The name is what the exception list is keyed by, so a mismatch would
	/// silently never break.
	/// </summary>
	string? ReadTypeName(ICorDebugModule module, mdTypeDef token) {
		if (token.IsNil)
			return null;
		var import = module.GetMetaDataInterface<IMetaDataImport>();
		if (import is null)
			return null;
		return ReadTypeName(import, token, 0);
	}

	string? ReadTypeName(IMetaDataImport import, mdTypeDef token, int depth) {
		// A type nested too deep is a pathological module; refusing to name it is better than recursing.
		if (depth > 16 || token.IsNil)
			return null;
		var (name, _, _) = import.GetTypeDefProps(token);
		if (string.IsNullOrEmpty(name))
			return null;
		// A nested type's own name carries no enclosing type, so the parent is walked up to and
		// joined with '+', the same spelling the definition files use.
		var enclosing = default(mdTypeDef);
		if (import.TryGetNestedClassProps(token, out enclosing) >= 0 && !enclosing.IsNil)
			return ReadTypeName(import, enclosing, depth + 1) is { } enclosingName ? enclosingName + "+" + name : null;
		return name;
	}
}
