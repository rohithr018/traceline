export interface JiraLinkedIssue {
	id: string;
	key: string;
	self: string;
}

export interface JiraIssueLinkType {
	id: string;
	name: string;
	inward: string;
	outward: string;
}

export interface JiraIssueLink {
	id: string;
	type: JiraIssueLinkType;
	inwardIssue?: JiraLinkedIssue;
	outwardIssue?: JiraLinkedIssue;
}

export interface JiraIssue {
	id: string;
	key: string;
	self: string;

	fields: {
		summary: string;
		description?: unknown;
		created: string;
		updated: string;

		project: {
			id: string;
			key: string;
			name: string;
		};

		issuetype: {
			id: string;
			name: string;
		};

		status: {
			id: string;
			name: string;
		};

		priority?: {
			id: string;
			name: string;
		} | null;

		assignee?: {
			accountId: string;
			displayName: string;
		} | null;

		labels?: string[];

		issuelinks?: JiraIssueLink[];
	};
}

export interface JiraSearchResponse {
	issues: JiraIssue[];
	nextPageToken?: string;
	isLast?: boolean;
}

export interface JiraClient {
	searchIssues(
		jql: string,
		nextPageToken?: string,
		maxResults?: number,
	): Promise<JiraSearchResponse>;
}
