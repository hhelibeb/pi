import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve as resolvePath, sep } from "node:path";
import { spawnProcessSync } from "./child-process.ts";

/**
 * Resolve a path to its canonical (real) form, following symlinks.
 * Falls back to the raw path if resolution fails (e.g. the target does
 * not exist yet), so that callers never crash on missing filesystem
 * entries.
 */
export function canonicalizePath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/**
 * Returns true if the value is NOT a package source (npm:, git:, etc.)
 * or a URL protocol. Bare names and relative paths without ./ prefix
 * are considered local.
 */

export function isLocalPath(value: string): boolean {
	const trimmed = value.trim();
	// Known non-local prefixes
	if (
		trimmed.startsWith("npm:") ||
		trimmed.startsWith("git:") ||
		trimmed.startsWith("github:") ||
		trimmed.startsWith("http:") ||
		trimmed.startsWith("https:") ||
		trimmed.startsWith("ssh:")
	) {
		return false;
	}
	return true;
}

/** Windows absolute path patterns: C:\... C:/... */
export const WIN_DRIVE_ABS = /^[a-zA-Z]:[\\/]/;
/** UNC path: \\server\share\... */
export const WIN_UNC = /^[\\/]{2}[^\\/]+[\\/][^\\/]/;
/** Device path: \\?\... \\.\... */
export const WIN_DEVICE = /^[\\/]{2}[?.][\\/]/;

/**
 * Normalize a POSIX-style Windows absolute path to proper Windows format.
 * Converts both colon form (/C:/Users/...) and MSYS no-colon form (/c/Users/...).
 * Multi-letter paths like /tmp, /usr, /home are never converted.
 * Non-matching paths are returned unchanged.
 */
export function normalizeWindowsDrivePath(p: string): string {
	if (process.platform !== "win32") {
		return p;
	}

	// /C:/Users/foo → C:/Users/foo (colon form, unambiguous)
	const withColon = p.match(/^\/([a-zA-Z]):(?=[\\/]|$)/);
	if (withColon) {
		return p.replace(/^\/([a-zA-Z]):(?=[\\/]|$)/, "$1:");
	}

	// /c/Users/foo → C:\Users\foo (MSYS no-colon form)
	// Only single-letter top-level directories — /tmp, /usr, /home never match.
	const msys = p.match(/^\/([a-zA-Z])(?:\/(.*)|$)$/);
	if (msys) {
		const drive = msys[1].toUpperCase();
		const rest = msys[2] ?? "";
		return rest ? `${drive}:\\${rest.replaceAll("/", "\\")}` : `${drive}:\\`;
	}

	return p;
}

/** Returns true for fully-qualified Windows absolute paths (drive, UNC, device). */
export function isFullyQualifiedWindowsPath(p: string): boolean {
	return WIN_DRIVE_ABS.test(p) || WIN_UNC.test(p) || WIN_DEVICE.test(p);
}

function resolveAgainstCwd(filePath: string, cwd: string): string {
	return isAbsolute(filePath) ? resolvePath(filePath) : resolvePath(cwd, filePath);
}

export function getCwdRelativePath(filePath: string, cwd: string): string | undefined {
	const resolvedCwd = resolvePath(cwd);
	const resolvedPath = resolveAgainstCwd(filePath, resolvedCwd);
	const relativePath = relative(resolvedCwd, resolvedPath);
	const isInsideCwd =
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));

	return isInsideCwd ? relativePath || "." : undefined;
}

export function formatPathRelativeToCwdOrAbsolute(filePath: string, cwd: string): string {
	const absolutePath = resolveAgainstCwd(filePath, cwd);
	return (getCwdRelativePath(absolutePath, cwd) ?? absolutePath).split(sep).join("/");
}

export function markPathIgnoredByCloudSync(path: string): void {
	const attrs =
		process.platform === "darwin"
			? ["com.dropbox.ignored", "com.apple.fileprovider.ignore#P"]
			: process.platform === "linux"
				? ["user.com.dropbox.ignored"]
				: [];

	for (const attr of attrs) {
		if (process.platform === "darwin") {
			spawnProcessSync("xattr", ["-w", attr, "1", path], { encoding: "utf-8", stdio: "ignore" });
		} else {
			spawnProcessSync("setfattr", ["-n", attr, "-v", "1", path], { encoding: "utf-8", stdio: "ignore" });
		}
	}
}
