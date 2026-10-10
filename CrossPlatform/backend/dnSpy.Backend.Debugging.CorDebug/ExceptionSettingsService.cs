using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// The exception types the client may break on, and which of them should stop the debuggee.
/// </summary>
/// <remarks>
/// The default categories and types are the same <c>*.ex.xml</c> files the WPF engine reads (see
/// <c>DefaultExceptionDefinitionsProvider</c> and <c>ExceptionsFileReader</c> in the extensions tree),
/// so the window lists what dnSpy on Windows lists. The client owns the user's changes and sends them
/// as a diff against the defaults — the same Add/Remove/Update shape <c>ExceptionListSettings</c>
/// persists — so this service only ever holds the defaults plus that diff.
///
/// The engine consults it on every exception event: the runtime hands over a type name and a module
/// name, neither of which needs the COM objects to still exist, so a lookup is a plain dictionary
/// read. It is taken under a lock because the client edits it from an RPC thread while the dispatcher
/// reads it.
/// </remarks>
internal sealed class ExceptionSettingsService {
	public const string DotNetCategory = "DotNet";
	public const string ModuleNameEquals = "moduleNameEquals";
	public const string ModuleNameNotEquals = "moduleNameNotEquals";

	/// <summary>One type the client can break on. <see cref="Name"/> and <see cref="Code"/> are mutually exclusive; both are null for a category's default row.</summary>
	readonly record struct ExceptionId(string Category, string? Name, int? Code);

	sealed record Category(string Name, string DisplayName, string ShortDisplayName, bool HasCode, bool DecimalCode, bool UnsignedCode);

	/// <summary>An entry the client sees: its identity, its defaults, and the description an added type carries.</summary>
	sealed record Definition(ExceptionId Id, string? Description, bool DefaultStopFirstChance, bool DefaultStopSecondChance);

	sealed record Condition(string Type, string Value);

	sealed class Setting {
		public bool StopFirstChance;
		public bool StopSecondChance;
		public List<Condition> Conditions = new();

		public Setting Clone() => new() { StopFirstChance = StopFirstChance, StopSecondChance = StopSecondChance, Conditions = new List<Condition>(Conditions) };
	}

	readonly object gate = new();
	readonly Dictionary<string, Category> categories = new(StringComparer.Ordinal);
	readonly List<string> categoryOrder = new();
	/// <summary>The types the files define, rebuilt from nothing on each reset; <see cref="definitions"/> is the editable copy.</summary>
	readonly List<Definition> parsedDefinitions = new();
	readonly Dictionary<ExceptionId, Definition> definitions = new();
	readonly Dictionary<ExceptionId, Setting> settings = new();
	readonly Dictionary<string, Regex> wildcardCache = new(StringComparer.Ordinal);

	public ExceptionSettingsService(string? debugDirectory = null) {
		debugDirectory ??= Path.Combine(AppContext.BaseDirectory, "debug");
		foreach (var file in EnumerateDefinitionFiles(debugDirectory))
			Read(file);
		lock (gate)
			ResetLocked();
	}

	static IEnumerable<string> EnumerateDefinitionFiles(string debugDirectory) {
		try {
			return Directory.Exists(debugDirectory)
				? Directory.GetFiles(debugDirectory, "*.ex.xml").OrderBy(file => file, StringComparer.OrdinalIgnoreCase)
				: [];
		}
		catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) {
			return [];
		}
	}

	// ---------------------------------------------------------------- reading the default data

	/// <summary>Mirrors <c>ExceptionsFileReader</c>: a malformed file is skipped whole rather than failing startup.</summary>
	void Read(string filename) {
		try {
			if (!File.Exists(filename))
				return;
			var root = XDocument.Load(filename, LoadOptions.None).Root;
			if (root?.Name != "Exceptions")
				return;
			foreach (var categoryElement in root.Elements("CategoryDef")) {
				var name = (string?)categoryElement.Attribute("Name");
				var displayName = (string?)categoryElement.Attribute("DisplayName");
				var shortDisplayName = (string?)categoryElement.Attribute("ShortDisplayName");
				if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(displayName) || string.IsNullOrWhiteSpace(shortDisplayName))
					continue;
				if (categories.ContainsKey(name))
					continue;
				var (hasCode, decimalCode, unsignedCode) = ParseCategoryFlags((string?)categoryElement.Attribute("Flags"));
				categories.Add(name, new Category(name, displayName, shortDisplayName, hasCode, decimalCode, unsignedCode));
				categoryOrder.Add(name);
			}
			foreach (var defsElement in root.Elements("ExceptionDefs")) {
				var category = (string?)defsElement.Attribute("Category");
				if (string.IsNullOrWhiteSpace(category) || !categories.ContainsKey(category))
					continue;
				foreach (var element in defsElement.Elements("Exception")) {
					var description = (string?)element.Attribute("Description");
					if (string.IsNullOrWhiteSpace(description))
						description = null;
					if (!TryReadId(category, (string?)element.Attribute("Name"), (string?)element.Attribute("Code"), out var id))
						continue;
					var (stopFirst, stopSecond) = ParseExceptionFlags((string?)element.Attribute("Flags"));
					var definition = new Definition(id, description, stopFirst, stopSecond);
					// A file contributes a type once; the first file to name it wins.
					if (parsedDefinitions.All(existing => existing.Id != id))
						parsedDefinitions.Add(definition);
				}
			}
		}
		catch {
			// A file that will not parse contributes nothing; the other files still list their types.
		}
	}

	static (bool HasCode, bool DecimalCode, bool UnsignedCode) ParseCategoryFlags(string? flags) {
		var hasCode = false;
		var decimalCode = false;
		var unsignedCode = false;
		foreach (var flag in Split(flags)) {
			switch (flag) {
				case "code": hasCode = true; break;
				case "decimal": decimalCode = true; break;
				case "unsigned": unsignedCode = true; break;
			}
		}
		return (hasCode, decimalCode, unsignedCode);
	}

	static (bool StopFirstChance, bool StopSecondChance) ParseExceptionFlags(string? flags) {
		var first = false;
		var second = false;
		foreach (var flag in Split(flags)) {
			switch (flag) {
				case "stop1": first = true; break;
				case "stop2": second = true; break;
			}
		}
		return (first, second);
	}

	static IEnumerable<string> Split(string? flags) =>
		flags is null ? [] : flags.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(flag => flag.Trim().ToLowerInvariant());

	static bool TryReadId(string category, string? name, string? codeText, out ExceptionId id) {
		id = default;
		if (codeText is null) {
			if (string.IsNullOrWhiteSpace(name))
				return false;
			id = new ExceptionId(category, name, null);
			return true;
		}
		if (!TryParseCode(codeText, out var code))
			return false;
		id = new ExceptionId(category, null, code);
		return true;
	}

	/// <summary>Decimal by default, <c>0x</c>/<c>&amp;H</c> for hex, unsigned when it will not fit in an int.</summary>
	static bool TryParseCode(string text, out int code) {
		code = 0;
		text = text.Trim();
		var hex = text.StartsWith("0x", StringComparison.OrdinalIgnoreCase) || text.StartsWith("&H", StringComparison.OrdinalIgnoreCase);
		if (hex) {
			text = text[2..];
			if (text != text.Trim() || text.StartsWith('-') || text.StartsWith('+'))
				return false;
			if (!int.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code)) {
				if (!uint.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var unsigned))
					return false;
				code = unchecked((int)unsigned);
			}
			return true;
		}
		if (!int.TryParse(text, CultureInfo.InvariantCulture, out code)) {
			if (!uint.TryParse(text, CultureInfo.InvariantCulture, out var unsigned))
				return false;
			code = unchecked((int)unsigned);
		}
		return true;
	}

	// ---------------------------------------------------------------- state

	/// <summary>
	/// Rebuilds the list from the defaults. Each category also gets a synthetic default row
	/// (<c>DefaultExceptionDefinitionsProvider</c>) whose settings a category-level check falls back to.
	/// </summary>
	void ResetLocked() {
		definitions.Clear();
		settings.Clear();
		foreach (var definition in parsedDefinitions)
			definitions[definition.Id] = definition;
		foreach (var category in categoryOrder) {
			var id = new ExceptionId(category, null, null);
			definitions[id] = new Definition(id, null, false, false);
		}
		foreach (var definition in definitions.Values)
			settings[definition.Id] = new Setting { StopFirstChance = definition.DefaultStopFirstChance, StopSecondChance = definition.DefaultStopSecondChance };
	}

	public void Reset() {
		lock (gate)
			ResetLocked();
	}

	/// <summary>Applies the client's stored diff: removes, then adds, then updates — the order <c>ExceptionListSettings</c> loads them in.</summary>
	public void Apply(JsonElement diff) {
		lock (gate) {
			ResetLocked();
			if (diff.ValueKind != JsonValueKind.Object)
				return;
			foreach (var element in Items(diff, "removed")) {
				if (!TryReadId(element, out var id))
					continue;
				definitions.Remove(id);
				settings.Remove(id);
			}
			foreach (var element in Items(diff, "added")) {
				if (!TryReadId(element, out var id))
					continue;
				var (stopFirst, stopSecond) = ReadFlags(element);
				var description = GetString(element, "description");
				if (string.IsNullOrWhiteSpace(description))
					description = null;
				definitions[id] = new Definition(id, description, stopFirst, stopSecond);
				settings[id] = ReadSetting(element, stopFirst, stopSecond);
			}
			foreach (var element in Items(diff, "updated")) {
				if (!TryReadId(element, out var id) || !settings.ContainsKey(id))
					continue;
				var (stopFirst, stopSecond) = ReadFlags(element);
				settings[id] = ReadSetting(element, stopFirst, stopSecond);
			}
		}
	}

	static Setting ReadSetting(JsonElement element, bool stopFirst, bool stopSecond) {
		var setting = new Setting { StopFirstChance = stopFirst, StopSecondChance = stopSecond };
		foreach (var condition in Items(element, "conditions")) {
			var type = GetString(condition, "type");
			var value = GetString(condition, "value");
			if (type is not (ModuleNameEquals or ModuleNameNotEquals) || string.IsNullOrWhiteSpace(value))
				continue;
			setting.Conditions.Add(new Condition(type, value));
		}
		return setting;
	}

	static (bool StopFirstChance, bool StopSecondChance) ReadFlags(JsonElement element) =>
		(GetBool(element, "stopFirstChance") ?? false, GetBool(element, "stopSecondChance") ?? false);

	static bool TryReadId(JsonElement element, out ExceptionId id) {
		id = default;
		var category = GetString(element, "category");
		if (string.IsNullOrWhiteSpace(category))
			return false;
		var name = GetString(element, "name");
		var code = GetInt(element, "code");
		if (name is not null)
			id = new ExceptionId(category, name, null);
		else if (code is not null)
			id = new ExceptionId(category, null, code);
		else
			id = new ExceptionId(category, null, null);
		return true;
	}

	static IEnumerable<JsonElement> Items(JsonElement parent, string name) =>
		parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array ? value.EnumerateArray() : [];

	static string? GetString(JsonElement element, string name) =>
		element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

	static int? GetInt(JsonElement element, string name) =>
		element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) ? number : null;

	static bool? GetBool(JsonElement element, string name) =>
		element.TryGetProperty(name, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.GetBoolean() : null;

	// ---------------------------------------------------------------- the client's view

	/// <summary>Every category and type, with its default and current flags, as the window renders them.</summary>
	public object BuildSnapshot() {
		lock (gate) {
			var categoryList = categoryOrder.Select(name => categories[name]).Select(category => new {
				name = category.Name,
				displayName = category.DisplayName,
				shortDisplayName = category.ShortDisplayName,
				hasCode = category.HasCode,
				decimalCode = category.DecimalCode,
				unsignedCode = category.UnsignedCode,
			}).ToArray();
			var exceptionList = definitions.Values
				.OrderBy(definition => categoryOrder.IndexOf(definition.Id.Category))
				.ThenBy(definition => definition.Id.Name is null && definition.Id.Code is null ? 0 : 1)
				.ThenBy(definition => definition.Id.Name, StringComparer.OrdinalIgnoreCase)
				.ThenBy(definition => definition.Id.Code)
				.Select(definition => {
					var setting = settings.TryGetValue(definition.Id, out var current) ? current : new Setting();
					return new {
						key = KeyOf(definition.Id),
						category = definition.Id.Category,
						name = definition.Id.Name,
						code = definition.Id.Code,
						description = definition.Description,
						defaultStopFirstChance = definition.DefaultStopFirstChance,
						defaultStopSecondChance = definition.DefaultStopSecondChance,
						stopFirstChance = setting.StopFirstChance,
						stopSecondChance = setting.StopSecondChance,
						conditions = setting.Conditions.Select(condition => new { type = condition.Type, value = condition.Value }).ToArray(),
					};
				}).ToArray();
			return new { categories = categoryList, exceptions = exceptionList };
		}
	}

	/// <summary>A stable string the client keys rows by; it only ever round-trips it.</summary>
	public static string KeyOf(string category, string? name, int? code) =>
		name is not null
			? category + "\u0001" + name
			: category + "\u0001#" + (code?.ToString(CultureInfo.InvariantCulture) ?? string.Empty);

	static string KeyOf(ExceptionId id) => KeyOf(id.Category, id.Name, id.Code);

	// ---------------------------------------------------------------- the engine's view

	/// <summary>
	/// Whether an exception should stop the debuggee, following <c>ExceptionConditionsChecker.ShouldBreak</c>:
	/// an unhandled exception always stops (this port has no <c>IgnoreUnhandledExceptions</c> setting),
	/// and a first-chance one stops only when its type is set to break when thrown and every condition holds.
	/// </summary>
	public bool ShouldStop(string category, string typeName, bool unhandled, string? moduleName) {
		if (unhandled)
			return true;
		lock (gate) {
			var setting = GetSettingLocked(new ExceptionId(category, typeName, null));
			if (!setting.StopFirstChance)
				return false;
			foreach (var condition in setting.Conditions) {
				var matches = ModuleMatches(condition.Value, moduleName);
				if (condition.Type == ModuleNameEquals ? !matches : matches)
					return false;
			}
			return true;
		}
	}

	/// <summary>The type's settings, falling back to the category's default row — <c>DbgExceptionSettingsServiceImpl.GetSettings</c>.</summary>
	Setting GetSettingLocked(ExceptionId id) {
		if (settings.TryGetValue(id, out var setting))
			return setting;
		if (settings.TryGetValue(new ExceptionId(id.Category, null, null), out setting))
			return setting;
		return new Setting();
	}

	bool ModuleMatches(string wildcard, string? moduleName) {
		if (moduleName is null)
			return false;
		if (!wildcardCache.TryGetValue(wildcard, out var regex)) {
			regex = new Regex("^" + Regex.Escape(wildcard).Replace(@"\*", ".*").Replace(@"\?", ".") + "$",
				RegexOptions.CultureInvariant | RegexOptions.IgnoreCase | RegexOptions.Singleline);
			wildcardCache[wildcard] = regex;
		}
		return regex.IsMatch(moduleName);
	}

	// ---------------------------------------------------------------- test seams

	internal IReadOnlyList<string> CategoryNames {
		get { lock (gate) return categoryOrder.ToArray(); }
	}

	internal int DefinitionCount {
		get { lock (gate) return definitions.Count; }
	}

	internal bool TryGetDefaults(string category, string name, out bool stopFirstChance, out bool stopSecondChance) {
		lock (gate) {
			if (definitions.TryGetValue(new ExceptionId(category, name, null), out var definition)) {
				stopFirstChance = definition.DefaultStopFirstChance;
				stopSecondChance = definition.DefaultStopSecondChance;
				return true;
			}
		}
		stopFirstChance = false;
		stopSecondChance = false;
		return false;
	}
}
