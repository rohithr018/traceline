import React from "react";
import {
	Heading,
	Inline,
	SectionMessage,
	Select,
	Spinner,
	Stack,
	Text,
} from "@forge/react";

import { CRITICALITY_OPTIONS } from "../constants/criticality";
import {
	formatNumber,
	getRiskAppearance,
	getRiskLevelLabel,
} from "../utils/formatters";

import RiskFactorRow from "./RiskFactorRow";

export default function RiskSummary({
	risk,
	onCriticalityChange,
	updatingNodeId,
	analysisLoading = false,
}) {
	if (!risk) {
		return (
			<SectionMessage appearance="information">
				<Text>Risk analysis is not available.</Text>
			</SectionMessage>
		);
	}

	return (
		<Stack space="space.200">
			<Heading size="medium">Risk intelligence</Heading>

			<SectionMessage appearance={getRiskAppearance(risk.overallLevel)}>
				<Stack space="space.100">
					<Text weight="bold">
						{getRiskLevelLabel(risk.overallLevel)} · {formatNumber(risk.overallScore)}/100
					</Text>

					<Inline alignBlock="center" spread="space-between">
						<Text>Average component risk</Text>
						<Text weight="medium">{formatNumber(risk.averageRisk)}/100</Text>
					</Inline>

					<Inline alignBlock="center" spread="space-between">
						<Text>Highest component risk</Text>
						<Text weight="medium">{formatNumber(risk.maximumRisk)}/100</Text>
					</Inline>

					<Inline alignBlock="center" spread="space-between">
						<Text>Affected components</Text>
						<Text weight="medium">{formatNumber(risk.affectedNodeCount, 0)}</Text>
					</Inline>
				</Stack>
			</SectionMessage>

			{risk.nodeRisks?.length > 0 && (
				<Stack space="space.200">
					<Heading size="small">Component risk breakdown</Heading>

					{risk.nodeRisks.map((item) => {
						const selectedOption =
							CRITICALITY_OPTIONS.find(
								(option) => option.value === item.criticality,
							) ?? CRITICALITY_OPTIONS[0];

						return (
							<Stack key={item.nodeId} space="space.150">
								<Stack space="space.050">
									<Inline alignBlock="center" spread="space-between">
										<Text weight="bold">{item.nodeId}</Text>
										<Text weight="bold">{formatNumber(item.score)}/100</Text>
									</Inline>

									<Inline alignBlock="center" spread="space-between">
										<Text>{getRiskLevelLabel(item.level)}</Text>
										<Text>Criticality: {item.criticality}</Text>
									</Inline>
								</Stack>

								<Stack space="space.050">
										<Text weight="bold">Component criticality</Text>

									<Select
										appearance="default"
										spacing="compact"
										options={CRITICALITY_OPTIONS}
										value={selectedOption}
										isDisabled={
											!onCriticalityChange ||
											analysisLoading ||
											updatingNodeId !== null
										}
										isSearchable={false}
										onChange={(option) => {
											if (
											onCriticalityChange &&
											option?.value &&
											option.value !== item.criticality
										) {
												onCriticalityChange(item.nodeId, option.value);
											}
										}}
									/>
								</Stack>

								{updatingNodeId === item.nodeId && (
									<Inline alignBlock="center" space="space.100">
										<Spinner size="small" />
										<Text>Updating risk...</Text>
									</Inline>
								)}

								<Heading size="small">Risk factor contributions</Heading>

								{item.contributors?.map((contributor) => (
									<RiskFactorRow
										key={contributor.factor}
										contributor={contributor}
									/>
								))}
							</Stack>
						);
					})}
				</Stack>
			)}
		</Stack>
	);
}
