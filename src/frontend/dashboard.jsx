import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@forge/bridge";
import ForgeReconciler, {
	Button,
	Heading,
	Inline,
	SectionMessage,
	Spinner,
	Stack,
	Text,
} from "@forge/react";

import JiraProjectSyncPanel from "./components/JiraProjectSyncPanel";
import PullRequestInvestigation from "./components/PullRequestInvestigation";
import ServiceConfigurationPanel from "./components/ServiceConfigurationPanel";
import WorkspacePairingPanel from "./components/WorkspacePairingPanel";
import { formatTimestamp, formatNumber } from "./utils/formatters";

function Metric({ label, value, hint }) {
	return (
		<SectionMessage appearance="information">
			<Stack space="space.050">
				<Text color="color.text.subtle" size="small">{label}</Text>
				<Heading size="large">{value}</Heading>
				{hint && <Text color="color.text.subtle" size="small">{hint}</Text>}
			</Stack>
		</SectionMessage>
	);
}

function PullRequestList({ pullRequests, analyses, onInvestigate, limit }) {
	if (pullRequests.length === 0) {
		return (
			<SectionMessage appearance="information">
				<Stack space="space.050">
					<Text weight="bold">No Bitbucket pull requests have arrived yet.</Text>
					<Text>Pair a workspace, configure the companion receiver, and create or update a pull request to send its first event.</Text>
				</Stack>
			</SectionMessage>
		);
	}

	return (
		<Stack space="space.100">
			{pullRequests.slice(0, limit).map((pullRequest) => {
				const risk = analyses[pullRequest.id]?.analysis?.risk;
				return (
					<SectionMessage key={pullRequest.id} appearance="information">
						<Inline alignBlock="center" spread="space-between" shouldWrap>
							<Stack space="space.050">
								<Text weight="bold">{pullRequest.name}</Text>
								<Text color="color.text.subtle" size="small">
									{pullRequest.repository} · {pullRequest.author || "Unknown author"} · {pullRequest.state}
								</Text>
								<Text color="color.text.subtle" size="small">
									{pullRequest.changedFileCount} changed files · updated {formatTimestamp(pullRequest.updatedOn)}
								</Text>
								<Text size="small">
									{risk
									? `Last analyzed in this session: ${risk.overallLevel} · ${formatNumber(risk.overallScore)}/100`
									: "Risk: analyze this pull request to calculate"}
								</Text>
							</Stack>
							<Button appearance="primary" onClick={() => onInvestigate(pullRequest)}>
								{analyses[pullRequest.id] ? "Open investigation" : "Investigate"}
							</Button>
						</Inline>
					</SectionMessage>
				);
			})}
			{pullRequests.length > limit && (
				<Text color="color.text.subtle">Showing {limit} of the {pullRequests.length} most recent pull requests loaded.</Text>
			)}
		</Stack>
	);
}

function TraceLineDashboard() {
	const [view, setView] = useState("overview");
	const [repositories, setRepositories] = useState([]);
	const [services, setServices] = useState([]);
	const [pullRequests, setPullRequests] = useState([]);
	const [analyses, setAnalyses] = useState({});
	const [selectedPullRequest, setSelectedPullRequest] = useState(null);
	const [loading, setLoading] = useState(true);
	const [loadingPullRequests, setLoadingPullRequests] = useState(false);
	const [analysisLoading, setAnalysisLoading] = useState(false);
	const [configurationError, setConfigurationError] = useState("");
	const [pullRequestError, setPullRequestError] = useState("");
	const [analysisError, setAnalysisError] = useState("");
	const [lastLoadedAt, setLastLoadedAt] = useState(null);
	const [pairingReadiness, setPairingReadiness] = useState(null);
	const [jiraReadiness, setJiraReadiness] = useState(null);
	const analysisRequest = useRef(0);
	const selectedIdRef = useRef(null);

	const loadDashboard = useCallback(async (quiet = false) => {
		if (!quiet) setLoading(true);
		setConfigurationError("");
		setPullRequestError("");
		try {
			const [configurationResponse, pullRequestResponse] = await Promise.all([
				invoke("service.listConfiguration"),
				invoke("bitbucket.listPullRequests"),
			]);
			if (configurationResponse?.ok) {
				setRepositories(configurationResponse.data?.repositories ?? []);
				setServices(configurationResponse.data?.services ?? []);
			} else {
				setConfigurationError(configurationResponse?.error?.message ?? "Unable to load service configuration.");
			}
			if (pullRequestResponse?.ok) {
				setPullRequests(pullRequestResponse.data?.pullRequests ?? []);
			} else {
				setPullRequestError(pullRequestResponse?.error?.message ?? "Unable to load pull requests.");
			}
			if (configurationResponse?.ok || pullRequestResponse?.ok) setLastLoadedAt(Date.now());
		} catch (err) {
			const message = err instanceof Error ? err.message : "Unable to load TraceLine data.";
			setConfigurationError(message);
			setPullRequestError(message);
		} finally {
			setLoading(false);
			setLoadingPullRequests(false);
		}
	}, []);

	useEffect(() => { loadDashboard(); }, [loadDashboard]);

	async function refreshDashboard() {
		setLoadingPullRequests(true);
		await loadDashboard(true);
	}

	async function investigate(pullRequest) {
		const requestNumber = ++analysisRequest.current;
		selectedIdRef.current = pullRequest.id;
		setSelectedPullRequest(pullRequest);
		setView("pullRequests");
		setAnalysisLoading(true);
		setAnalysisError("");
		try {
			const response = await invoke("bitbucket.analyzePullRequest", {
				pullRequestNodeId: pullRequest.id,
			});
			if (!response?.ok) {
				throw new Error(response?.error?.message ?? "Pull request analysis failed.");
			}
			setAnalyses((current) => ({ ...current, [pullRequest.id]: response.data }));
		} catch (err) {
			if (selectedIdRef.current === pullRequest.id) {
				setAnalysisError(err instanceof Error ? err.message : "Pull request analysis failed.");
			}
		} finally {
			if (requestNumber === analysisRequest.current) setAnalysisLoading(false);
		}
	}

	function chooseView(nextView) {
		setView(nextView);
		if (nextView !== "pullRequests") {
			selectedIdRef.current = null;
			analysisRequest.current++;
			setAnalysisLoading(false);
		}
	}

	const selectedAnalysis = selectedPullRequest ? analyses[selectedPullRequest.id] : null;
	const mappedServices = services.filter((service) => service.mappings?.length > 0).length;
	const pairedRepository = repositories.find((repository) => repository.paired);
	const activeWorkspaces = new Set(repositories.filter((repository) => repository.paired).map((repository) => repository.workspaceUuid)).size;
	const workspaceIsPaired = Boolean(pairedRepository) || pairingReadiness?.paired === true;
	const workspaceReadinessText = pairedRepository
		? `Workspace ${pairedRepository.workspaceUuid} has sent repository data.`
		: pairingReadiness?.workspaceUuid
			? `Workspace ${pairingReadiness.workspaceUuid} ${pairingReadiness.paired ? "is paired" : "is not paired"}.`
			: "Check or pair a Bitbucket workspace in Configuration.";
	const jiraProjectIsReady = jiraReadiness?.accessible === true && jiraReadiness.syncStatus === "SUCCEEDED" && jiraReadiness.indexedIssueCount > 0;
	const highRiskCount = selectedAnalysis?.analysis?.risk?.nodeRisks?.filter((item) => ["HIGH", "CRITICAL"].includes(item.level)).length;
	const analyzedPullRequestCount = Object.keys(analyses).length;
	const highRiskFindingsThisSession = Object.values(analyses).reduce(
		(total, analysis) => total + (analysis.analysis?.risk?.nodeRisks ?? []).filter((item) => ["HIGH", "CRITICAL"].includes(item.level)).length,
		0,
	);

	return (
		<Stack space="space.200">
			<SectionMessage appearance="information">
				<Stack space="space.100">
					<Inline alignBlock="center" spread="space-between" shouldWrap>
						<Stack space="space.050">
							<Heading size="large">TraceLine</Heading>
							<Text>Understand the impact of every engineering change before it reaches production.</Text>
							<Text color="color.text.subtle" size="small">Workspace configuration and Bitbucket PR investigations require Jira site administrator access. Jira issue findings are still filtered by your Jira permissions.</Text>
						</Stack>
						<Button appearance="subtle" onClick={refreshDashboard} isDisabled={loading || loadingPullRequests}>
							{loading || loadingPullRequests ? "Refreshing..." : "Refresh data"}
						</Button>
					</Inline>
					{lastLoadedAt && <Text color="color.text.subtle" size="small">Data refreshed {formatTimestamp(lastLoadedAt)}</Text>}
				</Stack>
			</SectionMessage>

			<Inline space="space.100" shouldWrap>
				<Button appearance={view === "overview" ? "primary" : "default"} onClick={() => chooseView("overview")}>Overview</Button>
				<Button appearance={view === "pullRequests" ? "primary" : "default"} onClick={() => chooseView("pullRequests")}>Pull requests</Button>
				<Button appearance={view === "configuration" ? "primary" : "default"} onClick={() => chooseView("configuration")}>Configuration</Button>
			</Inline>

			{(configurationError || pullRequestError) && (
				<SectionMessage appearance="error">
					<Stack space="space.100">
						{configurationError && <Text>Configuration: {configurationError}</Text>}
						{pullRequestError && <Text>Pull requests: {pullRequestError}</Text>}
						<Button appearance="primary" onClick={refreshDashboard} isDisabled={loadingPullRequests}>Retry loading data</Button>
					</Stack>
				</SectionMessage>
			)}

			{loading ? (
				<Inline alignBlock="center" space="space.100"><Spinner size="small" /><Text>Loading connected engineering data...</Text></Inline>
			) : view === "overview" ? (
				<Stack space="space.200">
					<Inline space="space.100" shouldWrap>
						<Metric label="Connected repositories" value={configurationError ? "—" : repositories.length} hint={configurationError ? "Configuration unavailable" : `${activeWorkspaces} paired workspace(s) with received repository data`} />
						<Metric label="Services with source mappings" value={configurationError ? "—" : mappedServices} hint={configurationError ? "Configuration unavailable" : `${services.length} configured service(s)`} />
						<Metric label="Recent pull requests loaded" value={pullRequestError ? "—" : pullRequests.length} hint={pullRequestError ? "Pull request list unavailable" : "Up to the 100 most recently updated"} />
						<Metric label="High or critical findings" value={analyzedPullRequestCount ? highRiskFindingsThisSession : "—"} hint={`Across ${analyzedPullRequestCount} PR(s) analyzed in this session`} />
					</Inline>

					<Stack space="space.100">
						<Inline alignBlock="center" spread="space-between" shouldWrap>
							<Heading size="medium">Recent pull requests</Heading>
							<Button appearance="subtle" onClick={() => chooseView("pullRequests")}>View all</Button>
						</Inline>
						{loadingPullRequests && <Inline alignBlock="center" space="space.100"><Spinner size="small" /><Text>Refreshing pull requests...</Text></Inline>}
							{!pullRequestError && <PullRequestList pullRequests={pullRequests} analyses={analyses} onInvestigate={investigate} limit={5} />}
					</Stack>

					{!configurationError && <SectionMessage appearance="information">
						<Stack space="space.100">
							<Heading size="small">Setup checklist</Heading>
							<Text>{workspaceIsPaired ? "Ready" : "Needs setup"} · {workspaceReadinessText}</Text>
							<Text>{repositories.length > 0 ? "Ready" : "Needs setup"} · {repositories.length > 0 ? `${repositories.length} repository record(s) received.` : "Deliver a signed pull request event to register a repository."}</Text>
							<Text>{mappedServices > 0 ? "Ready" : "Needs setup"} · {mappedServices} service(s) have source mappings.</Text>
							<Text>{pullRequests.length > 0 ? "Ready" : "Needs setup"} · {pullRequests.length} recent pull request(s) available.</Text>
							<Text>{jiraProjectIsReady ? "Ready" : "Needs setup"} · {jiraReadiness?.accessible ? `${jiraReadiness.projectKey}: ${jiraReadiness.indexedIssueCount} issue(s) indexed; latest sync ${jiraReadiness.syncStatus}.` : jiraReadiness?.error ? `${jiraReadiness.projectKey}: ${jiraReadiness.error}` : "Check or sync a Jira project in Configuration."}</Text>
							<Button appearance="primary" onClick={() => chooseView("configuration")}>Open configuration</Button>
						</Stack>
					</SectionMessage>}
				</Stack>
			) : view === "pullRequests" ? (
				<Stack space="space.200">
					<Stack space="space.050">
						<Heading size="medium">Pull request investigations</Heading>
						<Text color="color.text.subtle">Select a recent pull request to map changed files, trace affected services and Jira issues, and review evidence-based risk.</Text>
					</Stack>
					{loadingPullRequests && <Inline alignBlock="center" space="space.100"><Spinner size="small" /><Text>Refreshing pull requests...</Text></Inline>}
					{!pullRequestError && <PullRequestList pullRequests={pullRequests} analyses={analyses} onInvestigate={investigate} limit={100} />}
					{selectedPullRequest && (
						<Stack space="space.100">
							<Heading size="medium">Investigation</Heading>
							{highRiskCount !== undefined && <SectionMessage appearance={highRiskCount > 0 ? "warning" : "confirmation"}><Text>{highRiskCount} high or critical risk finding(s) in this pull request analysis.</Text></SectionMessage>}
							<PullRequestInvestigation
								key={selectedPullRequest.id}
								data={selectedAnalysis}
								loading={analysisLoading}
								error={analysisError}
								onAnalyze={() => investigate(selectedPullRequest)}
							/>
						</Stack>
					)}
				</Stack>
			) : (
				<Stack space="space.200">
					<Stack space="space.050">
						<Heading size="medium">Configuration</Heading>
						<Text color="color.text.subtle">Connect the sources that power TraceLine’s impact graph.</Text>
					</Stack>
					{configurationError ? (
						<SectionMessage appearance="information"><Text>Repository and service configuration is unavailable until the configuration request succeeds.</Text></SectionMessage>
					) : (
						<>
							<WorkspacePairingPanel
								repositories={repositories}
								onRefresh={() => loadDashboard(true)}
								onPairingChange={setPairingReadiness}
							/>
							<ServiceConfigurationPanel repositories={repositories} services={services} onSaved={() => loadDashboard(true)} />
							<SectionMessage appearance="information">
								<Stack space="space.050">
									<Heading size="small">Connected repositories</Heading>
									{repositories.length === 0 ? <Text>No repository events received yet.</Text> : repositories.map((repository) => <Text key={repository.id}>{repository.fullName || repository.name} · {repository.paired ? "workspace paired" : "workspace not paired"}</Text>)}
								</Stack>
							</SectionMessage>
						</>
					)}
					<JiraProjectSyncPanel
						onReadinessChange={setJiraReadiness}
						initialReadiness={jiraReadiness}
					/>
				</Stack>
			)}
		</Stack>
	);
}

ForgeReconciler.render(<TraceLineDashboard />);
