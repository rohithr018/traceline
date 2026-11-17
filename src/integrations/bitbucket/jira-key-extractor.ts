const JIRA_KEY_PATTERN = /(^|[^A-Z0-9_])([A-Z][A-Z0-9]*-\d+)(?=$|[^A-Z0-9_])/gi;

export function extractJiraKeys(text: string | undefined | null): string[] {
	if (!text) {
		return [];
	}

	const keys = new Set<string>();

	for (const match of text.matchAll(JIRA_KEY_PATTERN)) {
		keys.add(match[2].toUpperCase());
	}

	return [...keys];
}
