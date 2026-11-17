export function getChangedFilePath(file) {
	if (!file || typeof file !== "object") return "Unknown path";
	const oldPath = typeof file.oldPath === "string" ? file.oldPath : "";
	const newPath = typeof file.newPath === "string" ? file.newPath : "";
	if (oldPath && newPath && oldPath !== newPath) return `${oldPath} → ${newPath}`;
	return newPath || oldPath || (typeof file.path === "string" ? file.path : "Unknown path");
}

export function getChangedFileMappingStatus(file, unmatchedPaths = new Set()) {
	const candidatePaths = [file?.oldPath, file?.newPath, file?.path].filter(
		(path) => typeof path === "string" && path.length > 0,
	);
	if (candidatePaths.length === 0) return "Unknown";
	const unmatched = candidatePaths.filter((path) => unmatchedPaths.has(path));
	if (unmatched.length === 0) return "Mapped";
	if (unmatched.length === candidatePaths.length) return "Unmatched";
	return "Partially mapped";
}

function getFindingPath(finding) {
	const evidence = Array.isArray(finding?.evidence) ? finding.evidence : [];
	return evidence.find((path) => Array.isArray(path?.nodes) && path.nodes.length > 0) ?? null;
}

export function getFindingDisplayName(finding) {
	const path = getFindingPath(finding);
	const nodes = path?.nodes ?? [];
	return nodes[nodes.length - 1]?.name || finding?.nodeId || "Unknown component";
}

export function getFindingCategory(finding) {
	const path = getFindingPath(finding);
	const nodes = path?.nodes ?? [];
	const affectedNode = nodes[nodes.length - 1];
	if (affectedNode?.type === "ISSUE") return "Related Jira issue";
	if (affectedNode?.type === "SERVICE") {
		return path?.depth === 1 ? "Changed service" : "Downstream service";
	}
	return affectedNode?.type ? `Potentially affected ${affectedNode.type.toLowerCase()}` : "Potentially affected entity";
}
