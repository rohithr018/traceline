const JIRA_ISSUE_KEY_PATTERN =
	/(?<![A-Z0-9_])([A-Z][A-Z0-9_]*-\d+)(?![A-Z0-9_])/gi;

export function extractJiraIssueKeys(content: string): string[] {
	if (!content) {
		return [];
	}

	const keys = new Set<string>();

	for (const match of content.matchAll(JIRA_ISSUE_KEY_PATTERN)) {
		if (match[1]) {
			keys.add(match[1].toUpperCase());
		}
	}

	return [...keys];
}
