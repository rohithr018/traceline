import React, { useMemo } from "react";
import { Heading, Inline, SectionMessage, Stack, Text } from "@forge/react";

import { formatNumber } from "../utils/formatters";

const SEVERITIES = [
	{ value: "CRITICAL", label: "Critical" },
	{ value: "HIGH", label: "High" },
	{ value: "MEDIUM", label: "Medium" },
	{ value: "LOW", label: "Low" },
	{ value: null, label: "Unclassified" },
];

function getSeverityCount(findings, severity) {
	return findings.filter((finding) =>
		severity.value === null
			? finding.severity === null || finding.severity === undefined
			: finding.severity === severity.value,
	).length;
}

function byScoreDescending(a, b) {
	const scoreA = Number.isFinite(a.score) ? a.score : Number.NEGATIVE_INFINITY;
	const scoreB = Number.isFinite(b.score) ? b.score : Number.NEGATIVE_INFINITY;

	return scoreB - scoreA;
}

export default function InvestigationSummary({ findings = [], risk = null }) {
	const riskByNodeId = useMemo(() => {
		const nodeRisks = Array.isArray(risk?.nodeRisks) ? risk.nodeRisks : [];
		return new Map(nodeRisks.map((nodeRisk) => [nodeRisk.nodeId, nodeRisk]));
	}, [risk]);

	const highestImpact = useMemo(
		() => [...findings].sort(byScoreDescending).slice(0, 5),
		[findings],
	);

	const highestRisk = useMemo(() => {
		const nodeRisks = Array.isArray(risk?.nodeRisks) ? risk.nodeRisks : [];
		return [...nodeRisks].sort(byScoreDescending).slice(0, 5);
	}, [risk]);

	const impactScores = findings
		.map((finding) => finding.score)
		.filter(Number.isFinite);
	const averageImpact = impactScores.length
		? impactScores.reduce((total, score) => total + score, 0) /
		  impactScores.length
		: null;

	return (
		<Stack space="space.200">
			<Heading size="medium">Investigation summary</Heading>

			<Inline
				space="space.200"
				alignBlock="center"
				shouldWrap
				rowSpace="space.200"
			>
				<Stack space="space.050">
					<Text color="color.text.subtle" size="small">
						Affected components
					</Text>
					<Heading size="large">{findings.length}</Heading>
				</Stack>

				<Stack space="space.050">
					<Text color="color.text.subtle" size="small">
						Average impact
					</Text>
					<Heading size="large">{formatNumber(averageImpact)}</Heading>
				</Stack>

				<Stack space="space.050">
					<Text color="color.text.subtle" size="small">
						Overall affected-component risk
					</Text>
					<Heading size="large">
						{risk ? formatNumber(risk.overallScore) : "—"}
					</Heading>
				</Stack>
			</Inline>

			{risk && (
				<SectionMessage appearance="information">
					<Stack space="space.050">
						<Text weight="semibold">
							Risk across affected components: {risk.overallLevel ?? "Unavailable"}
						</Text>
						<Text size="small">
							Average component risk: {formatNumber(risk.averageRisk)} / 100
						</Text>
						<Text size="small">
							Maximum component risk: {formatNumber(risk.maximumRisk)} / 100
						</Text>
						<Text size="small" color="color.text.subtle">
							Impact scores describe dependency impact. Risk scores describe the
							affected components.
						</Text>
					</Stack>
				</SectionMessage>
			)}

			<Stack space="space.100">
				<Heading size="small">Findings by impact severity</Heading>

				{SEVERITIES.map((severity) => (
					<Inline
						key={severity.value ?? "UNCLASSIFIED"}
						alignBlock="center"
						spread="space-between"
					>
						<Text>{severity.label}</Text>
						<Text weight="semibold">
							{getSeverityCount(findings, severity)}
						</Text>
					</Inline>
				))}
			</Stack>

			<Stack space="space.100">
				<Heading size="small">Highest-impact components</Heading>

				{highestImpact.length === 0 ? (
					<Text color="color.text.subtle">
						No affected components were identified.
					</Text>
				) : (
					highestImpact.map((finding) => {
						const nodeRisk = riskByNodeId.get(finding.nodeId);

						return (
							<Stack key={finding.nodeId} space="space.050">
								<Inline alignBlock="center" spread="space-between">
									<Text weight="semibold">{finding.nodeId}</Text>
									<Text>Impact: {formatNumber(finding.score)}</Text>
								</Inline>

								<Inline space="space.200" shouldWrap rowSpace="space.100">
									<Text color="color.text.subtle" size="small">
										Severity: {finding.severity ?? "Unclassified"}
									</Text>
									<Text color="color.text.subtle" size="small">
										Risk: {nodeRisk ? formatNumber(nodeRisk.score) : "—"}
									</Text>
									<Text color="color.text.subtle" size="small">
										Criticality: {nodeRisk?.criticality ?? "—"}
									</Text>
								</Inline>
							</Stack>
						);
					})
				)}
			</Stack>

			<Stack space="space.100">
				<Heading size="small">Highest-risk components</Heading>

				{highestRisk.length === 0 ? (
					<Text color="color.text.subtle">
						No component risk scores are available.
					</Text>
				) : (
					highestRisk.map((nodeRisk) => (
						<Inline
							key={nodeRisk.nodeId}
							alignBlock="center"
							spread="space-between"
						>
							<Stack space="space.050">
								<Text weight="semibold">{nodeRisk.nodeId}</Text>
								<Text color="color.text.subtle" size="small">
									{nodeRisk.level ?? "Unclassified"} ·{" "}
									{nodeRisk.criticality ?? "Unknown"} criticality
								</Text>
							</Stack>

							<Text weight="semibold">
								{formatNumber(nodeRisk.score)} / 100
							</Text>
						</Inline>
					))
				)}
			</Stack>
		</Stack>
	);
}
