import api, { route } from "@forge/api";

import type { JiraClient, JiraSearchResponse } from "./jira-types";

export class ForgeJiraClient implements JiraClient {
	async searchIssues(
		jql: string,
		nextPageToken?: string,
		maxResults = 100,
	): Promise<JiraSearchResponse> {
		const body: Record<string, unknown> = {
			jql,
			maxResults,
			fields: [
				"summary",
				"description",
				"created",
				"updated",
				"project",
				"issuetype",
				"status",
				"priority",
				"assignee",
				"labels",
				"issuelinks",
			],
		};

		if (nextPageToken) {
			body.nextPageToken = nextPageToken;
		}

		const response = await api
			.asApp()
			.requestJira(route`/rest/api/3/search/jql`, {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});

		if (!response.ok) {
			const errorBody = await response.text();

			throw new Error(`Jira search failed (${response.status}): ${errorBody}`);
		}

		return (await response.json()) as JiraSearchResponse;
	}
}
