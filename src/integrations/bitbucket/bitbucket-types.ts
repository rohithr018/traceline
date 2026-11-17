export interface BitbucketPaginatedResponse<T> {
	values: T[];
	next?: string;
	size?: number;
	page?: number;
	pagelen?: number;
}

export interface BitbucketWorkspace {
	uuid: string;
	slug: string;
	name?: string;
	type?: string;
}

export interface BitbucketWorkspaceAccess {
	administrator: boolean;
	workspace: BitbucketWorkspace;
}

export interface BitbucketRepository {
	uuid: string;
	slug: string;
	name: string;
	full_name: string;
	description?: string | null;
	is_private: boolean;
	language?: string | null;
	html?: string;
	links?: {
		html?: { href: string };
		self?: { href: string };
	};
	mainbranch?: {
		name: string;
	};
	updated_on?: string;
}

export type BitbucketPullRequestState =
	| "OPEN"
	| "MERGED"
	| "DECLINED"
	| "SUPERSEDED";

export interface BitbucketBranch {
	name: string;
}

export interface BitbucketPullRequest {
	id: number;
	title: string;
	description?: string;
	state: BitbucketPullRequestState;
	created_on: string;
	updated_on: string;
	author?: {
		display_name?: string;
		uuid?: string;
		nickname?: string;
	};
	source: {
		branch?: BitbucketBranch;
		commit?: {
			hash: string;
		};
		repository?: {
			uuid: string;
			full_name: string;
			name: string;
		};
	};
	destination: {
		branch?: BitbucketBranch;
		commit?: {
			hash: string;
		};
		repository?: {
			uuid: string;
			full_name: string;
			name: string;
		};
	};
	links?: {
		html?: { href: string };
		self?: { href: string };
	};
	comment_count?: number;
	task_count?: number;
	draft?: boolean;
}

export interface BitbucketCommit {
	hash: string;
	message: string;
	date: string;
	author?: {
		raw?: string;
		user?: {
			display_name?: string;
			uuid?: string;
		};
	};
	parents?: Array<{
		hash: string;
	}>;
	links?: {
		html?: { href: string };
		self?: { href: string };
	};
}

export interface BitbucketDiffStat {
	status: string;
	lines_added: number;
	lines_removed: number;
	old?: {
		path: string;
		type?: string;
	};
	new?: {
		path: string;
		type?: string;
	};
}

export interface BitbucketClient {
	listWorkspaces(): Promise<BitbucketWorkspaceAccess[]>;
	listRepositories(workspaceId: string): Promise<BitbucketRepository[]>;
	listPullRequests(
		workspaceId: string,
		repositorySlug: string,
	): Promise<BitbucketPullRequest[]>;
	listPullRequestCommits(
		workspaceId: string,
		repositorySlug: string,
		pullRequestId: number,
	): Promise<BitbucketCommit[]>;
	listPullRequestDiffStat(
		workspaceId: string,
		repositorySlug: string,
		pullRequestId: number,
	): Promise<BitbucketDiffStat[]>;
}
