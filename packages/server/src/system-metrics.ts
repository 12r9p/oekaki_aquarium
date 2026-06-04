import type { SystemMetrics } from "@aquarium/shared";

const startedAt = Date.now();
const samples: SystemMetrics["samples"] = [];

export function recordSystemMetric(fishCount: number, fishCalculationMs: number, monitorCommunicationMs: number): void {
  samples.push({ t: Date.now(), fishCount, fishCalculationMs, monitorCommunicationMs });
  if (samples.length > 120) samples.splice(0, samples.length - 120);
}

export function getSystemMetrics(): SystemMetrics {
  return { startedAt, samples: [...samples] };
}
