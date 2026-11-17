import React, { useState } from "react";
import { invoke } from "@forge/bridge";
import {
	Button,
	Heading,
	Inline,
	SectionMessage,
	Select,
	Spinner,
	Stack,
	Text,
	Textfield,
} from "@forge/react";

import { CRITICALITY_OPTIONS } from "../constants/criticality";

function getRepositoryLabel(repository) {
	return repository.fullName || repository.name || repository.repositoryUuid;
}

function getRepositoryOptions(repositories) {
	return repositories.map((repository) => ({
		label: `${getRepositoryLabel(repository)}${repository.paired ? " · paired" : " · not paired"}`,
		value: repository.repositoryUuid,
	}));
}

export default function ServiceConfigurationPanel({
	repositories = [],
	services = [],
	onSaved,
}) {
	const repositoryOptions = getRepositoryOptions(repositories);
	const [serviceId, setServiceId] = useState("");
	const [name, setName] = useState("");
	const [criticality, setCriticality] = useState(CRITICALITY_OPTIONS[0]);
	const [mappings, setMappings] = useState([
		{ repositoryUuid: repositoryOptions[0]?.value ?? "", pathPrefix: "" },
	]);
	const [dependencies, setDependencies] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");

	function resetForm() {
		setServiceId("");
		setName("");
		setCriticality(CRITICALITY_OPTIONS[0]);
		setMappings([{ repositoryUuid: repositoryOptions[0]?.value ?? "", pathPrefix: "" }]);
		setDependencies("");
		setError("");
		setMessage("");
	}

	function editService(service) {
		setServiceId(service.id);
		setName(service.name);
		setCriticality(
			CRITICALITY_OPTIONS.find((option) => option.value === service.criticality) ??
				CRITICALITY_OPTIONS[0],
		);
		setMappings(
			service.mappings.length > 0
				? service.mappings.map((mapping) => ({ ...mapping }))
				: [{ repositoryUuid: repositoryOptions[0]?.value ?? "", pathPrefix: "" }],
		);
		setDependencies((service.dependsOnServiceIds ?? []).join(", "));
		setError("");
		setMessage("");
	}

	function updateMapping(index, field, value) {
		setMappings((current) =>
			current.map((mapping, mappingIndex) =>
				mappingIndex === index ? { ...mapping, [field]: value } : mapping,
			),
		);
	}

	async function saveService(event) {
		event?.preventDefault?.();
		setSaving(true);
		setError("");
		setMessage("");
		try {
			const response = await invoke("service.saveConfiguration", {
				serviceId: serviceId.trim(),
				name: name.trim(),
				criticality: criticality.value,
				mappings: mappings.map((mapping) => ({
					repositoryUuid: mapping.repositoryUuid,
					pathPrefix: mapping.pathPrefix.trim(),
				})),
				dependsOnServiceIds: dependencies
					.split(",")
					.map((id) => id.trim())
					.filter(Boolean),
			});
			if (!response?.ok) {
				throw new Error(response?.error?.message ?? "Could not save the service.");
			}
			setMessage(
				`${response.data.service.name} was saved. ${response.data.staleDependenciesRemoved} removed dependency link(s) were reconciled.`,
			);
			await onSaved?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save the service.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<Stack space="space.200">
			<Stack space="space.050">
				<Heading size="medium">Service source mappings</Heading>
				<Text color="color.text.subtle">
					Map repository paths to services. A path such as src/payment/ matches files inside that directory, including deeper folders.
				</Text>
			</Stack>

			{repositories.length === 0 ? (
				<SectionMessage appearance="information">
					<Text>Connect a Bitbucket workspace and deliver a pull request event before configuring source mappings.</Text>
				</SectionMessage>
			) : (
				<>
					{services.length > 0 && (
						<Stack space="space.100">
							<Heading size="small">Configured services</Heading>
							{services.map((service) => (
								<SectionMessage key={service.id} appearance="information">
									<Stack space="space.100">
										<Inline alignBlock="center" spread="space-between" shouldWrap>
											<Stack space="space.050">
												<Text weight="bold">{service.name}</Text>
												<Text size="small">{service.id} · {service.criticality} criticality</Text>
											</Stack>
											<Button appearance="subtle" onClick={() => editService(service)}>Edit</Button>
										</Inline>
										{service.mappings.map((mapping) => (
											<Text key={`${mapping.repositoryUuid}:${mapping.pathPrefix}`} size="small">
												{getRepositoryLabel(repositories.find((repository) => repository.repositoryUuid === mapping.repositoryUuid) ?? { repositoryUuid: mapping.repositoryUuid })} / {mapping.pathPrefix}/
											</Text>
										))}
										<Text size="small">
											Depends on: {service.dependsOnServiceIds?.length ? service.dependsOnServiceIds.join(", ") : "none configured"}
										</Text>
									</Stack>
								</SectionMessage>
							))}
						</Stack>
					)}

					<Stack space="space.150">
						<Heading size="small">{serviceId ? "Edit service" : "Add a service"}</Heading>
						<Stack space="space.050">
							<Text weight="semibold">Service ID</Text>
							<Textfield name="service-id" placeholder="service:payment" value={serviceId} onChange={(event) => setServiceId(event?.target?.value ?? "")} />
						</Stack>
						<Stack space="space.050">
							<Text weight="semibold">Service name</Text>
							<Textfield name="service-name" placeholder="Payment service" value={name} onChange={(event) => setName(event?.target?.value ?? "")} />
						</Stack>
						<Stack space="space.050">
							<Text weight="semibold">Criticality</Text>
							<Select options={CRITICALITY_OPTIONS} value={criticality} onChange={(option) => option && setCriticality(option)} isSearchable={false} />
						</Stack>

						<Stack space="space.100">
							<Text weight="semibold">Repository paths</Text>
							{mappings.map((mapping, index) => (
								<Stack key={index} space="space.050">
									<Select
										options={repositoryOptions}
										value={repositoryOptions.find((option) => option.value === mapping.repositoryUuid) ?? null}
										placeholder="Select repository"
										isSearchable
										onChange={(option) => updateMapping(index, "repositoryUuid", option?.value ?? "")}
									/>
									<Textfield
										name={`path-prefix-${index}`}
										placeholder="src/payment/"
										value={mapping.pathPrefix}
										onChange={(event) => updateMapping(index, "pathPrefix", event?.target?.value ?? "")}
									/>
									{mappings.length > 1 && (
										<Button appearance="subtle" onClick={() => setMappings((current) => current.filter((_, mappingIndex) => mappingIndex !== index))}>
											Remove path
										</Button>
									)}
								</Stack>
							))}
							<Button appearance="subtle" onClick={() => setMappings((current) => [...current, { repositoryUuid: repositoryOptions[0]?.value ?? "", pathPrefix: "" }])}>
								Add another repository path
							</Button>
						</Stack>

						<Stack space="space.050">
							<Text weight="semibold">Dependencies</Text>
							<Text size="small" color="color.text.subtle">Enter service IDs separated by commas. The service depends on each listed service.</Text>
							<Textfield name="service-dependencies" placeholder="service:database, service:identity" value={dependencies} onChange={(event) => setDependencies(event?.target?.value ?? "")} />
						</Stack>

						<Inline space="space.100" shouldWrap>
							<Button appearance="primary" onClick={saveService} isDisabled={saving || !repositories.length}>
								{saving ? "Saving service..." : "Save service"}
							</Button>
							{serviceId && <Button appearance="subtle" onClick={resetForm} isDisabled={saving}>Add another service</Button>}
						</Inline>
					</Stack>
				</>
			)}

			{saving && <Inline alignBlock="center" space="space.100"><Spinner size="small" /><Text>Saving service configuration...</Text></Inline>}
			{message && <SectionMessage appearance="confirmation"><Text>{message}</Text></SectionMessage>}
			{error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
		</Stack>
	);
}
