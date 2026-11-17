import api, { route, routeFromAbsolute } from "@forge/api";
import type { Route } from "@forge/api";

import type {
	BitbucketClient,
	BitbucketCommit,
	BitbucketDiffStat,
	BitbucketPaginatedResponse,
	BitbucketPullRequest,
	BitbucketRepository,
	BitbucketWorkspaceAccess,
} from "./bitbucket-types";

export class ForgeBitbucketClient implements BitbucketClient {
	private async getPage<T>(
		path: Route,
	): Promise<BitbucketPaginatedResponse<T>> {
		const response = await api.asApp().requestBitbucket(path, {
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			const errorBody = await response.text();

			throw new Error(
				`Bitbucket API request failed (${response.status}): ${errorBody}`,
			);
		}

		return (await response.json()) as BitbucketPaginatedResponse<T>;
	}

	private async getAllPages<T>(initialPath: Route): Promise<T[]> {
		const values: T[] = [];
		let nextPath: Route | undefined = initialPath;

		while (nextPath) {
			const page: BitbucketPaginatedResponse<T> =
				await this.getPage<T>(nextPath);

			values.push(...page.values);

			nextPath = page.next ? routeFromAbsolute(page.next) : undefined;
		}

		return values;
	}

	async listWorkspaces(): Promise<BitbucketWorkspaceAccess[]> {
		return this.getAllPages<BitbucketWorkspaceAccess>(
			route`/2.0/user/workspaces`,
		);
	}

	async listRepositories(workspaceId: string): Promise<BitbucketRepository[]> {
		return this.getAllPages<BitbucketRepository>(
			route`/2.0/repositories/${workspaceId}`,
		);
	}

	async listPullRequests(
		workspaceId: string,
		repositorySlug: string,
	): Promise<BitbucketPullRequest[]> {
		return this.getAllPages<BitbucketPullRequest>(
			route`/2.0/repositories/${workspaceId}/${repositorySlug}/pullrequests?state=OPEN&state=MERGED&state=DECLINED`,
		);
	}

	async listPullRequestCommits(
		workspaceId: string,
		repositorySlug: string,
		pullRequestId: number,
	): Promise<BitbucketCommit[]> {
		return this.getAllPages<BitbucketCommit>(
			route`/2.0/repositories/${workspaceId}/${repositorySlug}/pullrequests/${pullRequestId}/commits`,
		);
	}

	async listPullRequestDiffStat(
		workspaceId: string,
		repositorySlug: string,
		pullRequestId: number,
	): Promise<BitbucketDiffStat[]> {
		return this.getAllPages<BitbucketDiffStat>(
			route`/2.0/repositories/${workspaceId}/${repositorySlug}/pullrequests/${pullRequestId}/diffstat`,
		);
	}
}
