using System.Text.Json;
using System.Text.Json.Serialization;
using dnlib.DotNet;
using dnSpy.Backend.Core.Editing;
using Xunit;

namespace dnSpy.Backend.Tests.Editing;

/// <summary>
/// Helpers the editing tests share: a module that can hold new rows, an edit context over it, and the
/// comparison used to check that a value survived a trip through dnlib and back.
/// </summary>
static class EditTestModule {
	/// <summary>A module with a corlib behind it and one type whose base type is a second type of the module.</summary>
	public static (ModuleDef Module, TypeDef Type) Create(string typeName = "Widget") {
		var module = new ModuleDefUser("TestModule");
		var type = AddType(module, "Ns", typeName);
		type.BaseType = AddType(module, "Ns", "Base");
		return (module, type);
	}

	public static TypeDef AddType(ModuleDef module, string @namespace, string name) {
		var type = module.UpdateRowId(new TypeDefUser(@namespace, name) {
			Attributes = TypeAttributes.Public | TypeAttributes.AutoLayout | TypeAttributes.Class | TypeAttributes.AnsiClass,
		});
		module.Types.Add(type);
		return type;
	}

	/// <summary>Adds a method of the type, with a row of its own so its token can name it.</summary>
	public static MethodDef AddMethod(TypeDef type, string name, MethodSig? signature = null) {
		var method = type.Module.UpdateRowId(new MethodDefUser(
			name,
			signature ?? MethodSig.CreateInstance(type.Module.CorLibTypes.Void)));
		type.Methods.Add(method);
		return method;
	}

	/// <summary>A constructor a custom attribute can point at, in a type of its own.</summary>
	public static MethodDef AddAttributeConstructor(ModuleDef module) =>
		AddMethod(AddType(module, "Ns", "MarkerAttribute"), ".ctor", MethodSig.CreateInstance(module.CorLibTypes.Void));

	/// <summary>
	/// An edit context that can also name a row the way a client would — by node id. A node id is the
	/// workspace's own "path:kind:token" form, and the lookup the workspace hands the editor answers with
	/// the dnlib object it holds for that node, so this stand-in recognises a method's token.
	/// </summary>
	public static EditContext Context(ModuleDef module, TypeDef? owner = null) => new(
		module,
		null,
		nodeId => owner?.Methods.FirstOrDefault(method => nodeId.EndsWith($":{method.MDToken.Raw:X8}", StringComparison.Ordinal)));

	/// <summary>
	/// Compares two DTOs field by field, by round-tripping them through the same JSON settings the RPC
	/// server uses. A record's own equality compares its list members by reference, so it would call every
	/// round trip different; this compares what actually travels.
	/// </summary>
	public static void AssertSameDto<T>(T expected, T actual) =>
		Assert.Equal(
			JsonSerializer.Serialize(expected, JsonOptions),
			JsonSerializer.Serialize(actual, JsonOptions));

	static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

	// The server's own settings, repeated here because the test project does not reference the host.
	static JsonSerializerOptions CreateJsonOptions() {
		var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) {
			WriteIndented = true,
		};
		options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
		return options;
	}
}
