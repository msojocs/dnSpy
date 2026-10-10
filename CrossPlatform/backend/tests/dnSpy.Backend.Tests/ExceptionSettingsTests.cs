using System.Text.Json;
using dnSpy.Backend.Debugging.CorDebug;
using Xunit;

namespace dnSpy.Backend.Tests;

/// <summary>
/// The exception list the engine reads. It is the data dnSpy on Windows ships, so the assertions here
/// pin the shape that data has: two categories, the types the definition files name, and the stop rule
/// <c>ExceptionConditionsChecker</c> applies to them.
/// </summary>
public sealed class ExceptionSettingsTests {
	[Fact]
	public void LoadsTheCategoriesAndTypesTheWindowsEngineShips() {
		var service = CreateService();

		Assert.Equal(["DotNet", "MDA"], service.CategoryNames);
		// 429 named types in the file plus one default row per category.
		Assert.Equal(431, service.DefinitionCount);

		Assert.True(service.TryGetDefaults("DotNet", "System.InvalidOperationException", out var first, out var second));
		Assert.False(first);
		Assert.True(second);
		// A type the file marks as a default break-when-thrown.
		Assert.True(service.TryGetDefaults("DotNet", "System.Reflection.MissingMetadataException", out first, out _));
		Assert.True(first);
	}

	[Fact]
	public void AnUnhandledExceptionAlwaysStops() {
		var service = CreateService();

		// Not set to break when thrown, and it stops anyway: an unhandled exception is what WPF stops on.
		Assert.True(service.ShouldStop("DotNet", "System.InvalidOperationException", unhandled: true, moduleName: null));
	}

	[Fact]
	public void AFirstChanceExceptionStopsOnlyWhenItsTypeSaysSo() {
		var service = CreateService();

		Assert.False(service.ShouldStop("DotNet", "System.InvalidOperationException", unhandled: false, moduleName: "app.dll"));
		Assert.True(service.ShouldStop("DotNet", "System.Reflection.MissingMetadataException", unhandled: false, moduleName: "System.Private.CoreLib.dll"));
	}

	[Fact]
	public void TheCategoryDefaultRowCoversTypesThatAreNotListed() {
		var service = CreateService();

		Assert.False(service.ShouldStop("DotNet", "Some.Unlisted.Exception", unhandled: false, moduleName: null));

		service.Apply(Diff(updated: [new { category = "DotNet", name = (string?)null, code = (int?)null, stopFirstChance = true, stopSecondChance = false }]));

		Assert.True(service.ShouldStop("DotNet", "Some.Unlisted.Exception", unhandled: false, moduleName: null));
	}

	[Fact]
	public void ConditionsFilterByModuleName() {
		var service = CreateService();
		service.Apply(Diff(updated: [new {
			category = "DotNet",
			name = "System.InvalidOperationException",
			code = (int?)null,
			stopFirstChance = true,
			stopSecondChance = false,
			conditions = new[] { new { type = "moduleNameEquals", value = "MyApp*" } },
		}]));

		Assert.True(service.ShouldStop("DotNet", "System.InvalidOperationException", unhandled: false, moduleName: "MyApp.exe"));
		Assert.False(service.ShouldStop("DotNet", "System.InvalidOperationException", unhandled: false, moduleName: "Other.exe"));
	}

	[Fact]
	public void RemovedTypesDisappearAndAddedOnesAppear() {
		var service = CreateService();
		var before = service.DefinitionCount;

		service.Apply(Diff(
			removed: [new { category = "DotNet", name = "System.InvalidOperationException", code = (int?)null }],
			added: [new { category = "DotNet", name = (string?)"My.Custom.Exception", code = (int?)null, description = "a custom type", stopFirstChance = true, stopSecondChance = false }]));

		Assert.Equal(before, service.DefinitionCount);
		Assert.False(service.TryGetDefaults("DotNet", "System.InvalidOperationException", out _, out _));
		Assert.True(service.TryGetDefaults("DotNet", "My.Custom.Exception", out var first, out _));
		Assert.True(first);
		Assert.True(service.ShouldStop("DotNet", "My.Custom.Exception", unhandled: false, moduleName: null));
	}

	[Fact]
	public void ResetDropsEveryChange() {
		var service = CreateService();
		service.Apply(Diff(updated: [new { category = "DotNet", name = (string?)null, code = (int?)null, stopFirstChance = true, stopSecondChance = false }]));
		Assert.True(service.ShouldStop("DotNet", "Some.Unlisted.Exception", unhandled: false, moduleName: null));

		service.Reset();

		Assert.False(service.ShouldStop("DotNet", "Some.Unlisted.Exception", unhandled: false, moduleName: null));
	}

	[Fact]
	public void ApplyingTheSameDiffTwiceIsTheSameList() {
		var service = CreateService();
		var diff = Diff(updated: [new { category = "DotNet", name = "System.InvalidOperationException", code = (int?)null, stopFirstChance = true, stopSecondChance = true }]);

		service.Apply(diff);
		var once = JsonSerializer.Serialize(service.BuildSnapshot());
		service.Apply(diff);

		Assert.Equal(once, JsonSerializer.Serialize(service.BuildSnapshot()));
	}

	static ExceptionSettingsService CreateService() {
		var debugDirectory = Path.Combine(AppContext.BaseDirectory, "debug");
		Assert.True(File.Exists(Path.Combine(debugDirectory, "DotNet.ex.xml")), $"The definition file was not copied: {debugDirectory}");
		return new ExceptionSettingsService(debugDirectory);
	}

	/// <summary>A client's diff, built the way the window serializes one.</summary>
	static JsonElement Diff(object?[]? removed = null, object?[]? added = null, object?[]? updated = null) =>
		JsonSerializer.SerializeToElement(new { removed, added, updated });
}
