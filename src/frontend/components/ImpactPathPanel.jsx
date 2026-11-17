import React from "react";
import { Button, Heading, Inline, SectionMessage, Stack, Text } from "@forge/react";
import { formatNumber, formatPercent } from "../utils/formatters";

function EvidencePath({ path, index }) {
	const nodes = Array.isArray(path?.nodes) ? path.nodes : [];
	const relationships = Array.isArray(path?.relationships)
		? path.relationships
		: [];
	const depth = Number.isFinite(path?.depth) ? path.depth : relationships.length;

	return (
		<Stack space="space.100">
			<Inline alignBlock="center" spread="space-between" shouldWrap>
				<Heading size="small">Path {index + 1}</Heading>
				<Text color="color.text.subtle" size="small">
					Confidence: {formatPercent(path.confidence)}
				</Text>
			</Inline>

			<Text color="color.text.subtle" size="small">
				{depth} relationship{depth === 1 ? "" : "s"}
			</Text>

			{nodes.length === 0 ? (
				<Text color="color.text.subtle" size="small">
					Node details are unavailable for this path.
				</Text>
			) : (
				<Stack space="space.100">
				{nodes.map((node, nodeIndex) => {
					if (!node?.id) return null;

					const relationship = relationships[nodeIndex];

					return (
						<Stack key={`${node.id}-${nodeIndex}`} space="space.050">
							<Inline alignBlock="center" space="space.100">
								<Text weight="semibold">{node.name || node.id}</Text>
								{node.type && (
									<Text color="color.text.subtle" size="small">
										{node.type}
									</Text>
								)}
							</Inline>
							{node.url && (
								<Button appearance="link" onClick={() => window.open(node.url, "_blank", "noopener,noreferrer")}>
									Open in source
								</Button>
							)}

							<Text color="color.text.subtle" size="small">
								{node.id}
							</Text>

							{relationship && (
								<Stack space="space.050">
									<Text weight="semibold" size="small">
										↓ {relationship.propagatedToDependent ? "IMPACTS_DEPENDENT" : relationship.type ?? "RELATED_TO"}
									</Text>

									{relationship.evidenceText && (
										<Text color="color.text.subtle" size="small">
											{relationship.evidenceText}
										</Text>
									)}

									{relationship.sourceSystem && (
										<Text color="color.text.subtle" size="small">
											Source: {relationship.sourceSystem}
										</Text>
									)}

									{relationship.externalReference && (
										<Text color="color.text.subtle" size="small">
											Reference: {relationship.externalReference}
										</Text>
									)}
								</Stack>
							)}
						</Stack>
					);
				})}
				</Stack>
			)}
		</Stack>
	);
}

export default function ImpactPathPanel({ finding = null }) {
	if (!finding) {
		return null;
	}

	const evidence = Array.isArray(finding.evidence)
		? finding.evidence.filter(Boolean)
		: [];

	return (
		<Stack space="space.150">
			<Heading size="medium">Impact path investigation</Heading>

			<Stack space="space.050">
				<Text weight="semibold">Affected component: {finding.nodeId}</Text>

				<Inline alignBlock="center" space="space.200">
					{finding.severity && (
						<Text size="small">Impact severity: {finding.severity}</Text>
					)}

				{finding.score !== null && finding.score !== undefined && (
						<Text size="small">
						Impact score: {formatNumber(finding.score)} / 100
						</Text>
					)}
				</Inline>

				{finding.explanation && (
					<Text color="color.text.subtle">{finding.explanation}</Text>
				)}
			</Stack>

			{evidence.length === 0 ? (
				<SectionMessage appearance="warning">
					<Text>No detailed evidence paths are available for this finding.</Text>
				</SectionMessage>
			) : (
				<Stack space="space.200">
					<Heading size="small">Evidence paths ({evidence.length})</Heading>

					{evidence.map((path, index) => (
						<SectionMessage
							key={`${finding.nodeId}-path-${index}`}
							appearance="information"
						>
							<EvidencePath path={path} index={index} />
						</SectionMessage>
					))}
				</Stack>
			)}
		</Stack>
	);
}
