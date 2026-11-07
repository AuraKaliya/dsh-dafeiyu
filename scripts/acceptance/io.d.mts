export const repository: string;
export function hash(value: unknown): string;
export function fingerprint(kind: 'source' | 'runtime' | 'driver'): string;
export function readJson(file: string): unknown;
export function saveJson(file: string, value: unknown): void;
export function captureEvidence(scenarioId: string, version: string, apiVersion: number, evidence: unknown): void;
