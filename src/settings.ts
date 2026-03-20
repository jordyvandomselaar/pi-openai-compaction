import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_EXTENSION_SETTINGS,
	EXTENSION_SETTINGS_FILE,
	EXTENSION_SETTINGS_KEY,
	type ExtensionSettings,
	type LoadedExtensionSettings,
} from "./types";

const GLOBAL_SETTINGS_PATH = path.join(os.homedir(), ".pi", "agent", "settings.json");
const PROJECT_SETTINGS_DIR = ".pi";
const PROJECT_SETTINGS_FILE = "settings.json";
const ENV_PREFIX = "PI_OPENAI_NATIVE_COMPACTION_";
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_SETTINGS_PATH = path.join(PACKAGE_ROOT, EXTENSION_SETTINGS_FILE);

type SettingsSourceKind = "extension" | "global" | "project";
type PartialSettings = Partial<ExtensionSettings>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function readJsonObject(filePath: string, warnings: string[]): Record<string, unknown> | undefined {
	if (!isFile(filePath)) return undefined;

	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
		if (isRecord(parsed)) return parsed;
		warnings.push(`Ignoring ${filePath}: expected a JSON object at the top level.`);
		return undefined;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`Ignoring ${filePath}: ${message}`);
		return undefined;
	}
}

function resolveConfiguredPath(rawPath: string, baseDir: string): string {
	if (rawPath.startsWith("~/")) {
		return path.join(os.homedir(), rawPath.slice(2));
	}
	if (path.isAbsolute(rawPath)) {
		return path.resolve(rawPath);
	}
	return path.resolve(baseDir, rawPath);
}

function toBoolean(value: unknown, fieldPath: string, warnings: string[]): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "boolean") return value;
	warnings.push(`Ignoring ${fieldPath}: expected a boolean.`);
	return undefined;
}

function toStringArray(value: unknown, fieldPath: string, warnings: string[]): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
		warnings.push(`Ignoring ${fieldPath}: expected a string array.`);
		return undefined;
	}
	return [...new Set(value.map((item) => item.trim()))];
}

function readConfigBlock(
	settings: Record<string, unknown> | undefined,
	settingsPath: string,
	kind: SettingsSourceKind,
	warnings: string[],
): PartialSettings {
	if (!settings) return {};

	const rawConfig = kind === "extension" ? settings[EXTENSION_SETTINGS_KEY] ?? settings : settings[EXTENSION_SETTINGS_KEY];
	if (rawConfig === undefined) return {};
	if (!isRecord(rawConfig)) {
		warnings.push(`Ignoring ${settingsPath}${kind === "extension" ? "" : `:${EXTENSION_SETTINGS_KEY}`}: expected an object.`);
		return {};
	}

	const config = rawConfig;
	const resolved: PartialSettings = {};
	const blockPath = kind === "extension" ? settingsPath : `${settingsPath}:${EXTENSION_SETTINGS_KEY}`;

	resolved.enabled = toBoolean(config.enabled, `${blockPath}.enabled`, warnings);
	resolved.debug = toBoolean(config.debug, `${blockPath}.debug`, warnings);
	resolved.logProviderPayloads = toBoolean(config.logProviderPayloads, `${blockPath}.logProviderPayloads`, warnings);
	resolved.logCompactResponses = toBoolean(config.logCompactResponses, `${blockPath}.logCompactResponses`, warnings);
	resolved.redactSensitiveData = toBoolean(config.redactSensitiveData, `${blockPath}.redactSensitiveData`, warnings);
	resolved.notifyOnLoad = toBoolean(config.notifyOnLoad, `${blockPath}.notifyOnLoad`, warnings);

	const artifactPathValue = config.artifactRoot ?? config.artifactDir;
	if (artifactPathValue !== undefined) {
		if (typeof artifactPathValue === "string" && artifactPathValue.trim().length > 0) {
			resolved.artifactRoot = resolveConfiguredPath(artifactPathValue.trim(), path.dirname(settingsPath));
		} else {
			warnings.push(`Ignoring ${blockPath}.artifactRoot: expected a non-empty string.`);
		}
	}

	resolved.supportedProviders = toStringArray(config.supportedProviders, `${blockPath}.supportedProviders`, warnings);
	resolved.supportedApis = toStringArray(config.supportedApis, `${blockPath}.supportedApis`, warnings);

	return Object.fromEntries(Object.entries(resolved).filter(([, value]) => value !== undefined)) as PartialSettings;
}

function applyEnvOverrides(settings: ExtensionSettings): ExtensionSettings {
	const resolveEnvBoolean = (name: string): boolean | undefined => {
		const value = process.env[`${ENV_PREFIX}${name}`]?.trim().toLowerCase();
		if (!value) return undefined;
		if (["1", "true", "yes", "on"].includes(value)) return true;
		if (["0", "false", "no", "off"].includes(value)) return false;
		return undefined;
	};

	const resolveEnvCsv = (name: string): string[] | undefined => {
		const rawValue = process.env[`${ENV_PREFIX}${name}`]?.trim();
		if (!rawValue) return undefined;
		const items = rawValue
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
		return items.length > 0 ? [...new Set(items)] : undefined;
	};

	const artifactRoot = process.env[`${ENV_PREFIX}ARTIFACT_ROOT`]?.trim();
	return {
		...settings,
		enabled: resolveEnvBoolean("ENABLED") ?? settings.enabled,
		debug: resolveEnvBoolean("DEBUG") ?? settings.debug,
		logProviderPayloads: resolveEnvBoolean("LOG_PROVIDER_PAYLOADS") ?? settings.logProviderPayloads,
		logCompactResponses: resolveEnvBoolean("LOG_COMPACT_RESPONSES") ?? settings.logCompactResponses,
		redactSensitiveData: resolveEnvBoolean("REDACT_SENSITIVE_DATA") ?? settings.redactSensitiveData,
		notifyOnLoad: resolveEnvBoolean("NOTIFY_ON_LOAD") ?? settings.notifyOnLoad,
		artifactRoot:
			typeof artifactRoot === "string" && artifactRoot.length > 0
				? resolveConfiguredPath(artifactRoot, process.cwd())
				: settings.artifactRoot,
		supportedProviders: resolveEnvCsv("SUPPORTED_PROVIDERS") ?? settings.supportedProviders,
		supportedApis: resolveEnvCsv("SUPPORTED_APIS") ?? settings.supportedApis,
	};
}

export function loadExtensionSettings(cwd?: string): LoadedExtensionSettings {
	const warnings: string[] = [];
	const sources: string[] = [];
	const projectSettingsPath = cwd ? path.join(cwd, PROJECT_SETTINGS_DIR, PROJECT_SETTINGS_FILE) : undefined;
	const extensionSettings = readJsonObject(EXTENSION_SETTINGS_PATH, warnings);
	const globalSettings = readJsonObject(GLOBAL_SETTINGS_PATH, warnings);
	const projectSettings = projectSettingsPath ? readJsonObject(projectSettingsPath, warnings) : undefined;

	let resolved: ExtensionSettings = { ...DEFAULT_EXTENSION_SETTINGS };

	const extensionConfig = readConfigBlock(extensionSettings, EXTENSION_SETTINGS_PATH, "extension", warnings);
	if (Object.keys(extensionConfig).length > 0) {
		resolved = { ...resolved, ...extensionConfig };
		sources.push(EXTENSION_SETTINGS_PATH);
	}

	const globalConfig = readConfigBlock(globalSettings, GLOBAL_SETTINGS_PATH, "global", warnings);
	if (Object.keys(globalConfig).length > 0) {
		resolved = { ...resolved, ...globalConfig };
		sources.push(GLOBAL_SETTINGS_PATH);
	}

	if (projectSettingsPath) {
		const projectConfig = readConfigBlock(projectSettings, projectSettingsPath, "project", warnings);
		if (Object.keys(projectConfig).length > 0) {
			resolved = { ...resolved, ...projectConfig };
			sources.push(projectSettingsPath);
		}
	}

	resolved = applyEnvOverrides(resolved);
	resolved.artifactRoot = resolveConfiguredPath(resolved.artifactRoot, cwd ?? process.cwd());
	resolved.supportedProviders = [...new Set(resolved.supportedProviders.map((item) => item.trim()).filter(Boolean))];
	resolved.supportedApis = [...new Set(resolved.supportedApis.map((item) => item.trim()).filter(Boolean))];

	return {
		settings: resolved,
		sources,
		warnings,
	};
}
