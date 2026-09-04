"use client";

import type { SessionVm } from "@/lib/use-session";
import { telemetry } from "@/lib/telemetry";

export interface EvalData {
  turnId: string;
  generationId: string;
  state: string;
  provider: string;
  model: string;
  voice: string;
  tool: string;
  intentProvider: string;
  summary: ReturnType<typeof telemetry.summary>;
}

interface EvalPanelProps {
  eval: EvalData;
  vm: SessionVm;
}

export function EvalPanel({ eval: e, vm }: EvalPanelProps) {
  const toolSamples = telemetry.byName("tool.executed");
  const toolLatency =
    toolSamples.length > 0 ? toolSamples[toolSamples.length - 1].durationMs : null;
  const synthSamples = telemetry.byName("synth.sent");
  const synthLatency =
    synthSamples.length > 0 ? synthSamples[synthSamples.length - 1].durationMs : null;
  const fencedSamples = telemetry.byName("speech.fenced");
  const staleRejected = telemetry.byName("stale.result.rejected").length;
  const closeSamples = telemetry.byName("closure.started");
  const closureLatency =
    closeSamples.length > 0 ? closeSamples[closeSamples.length - 1].durationMs : null;
  const interrupts = telemetry.all.filter((s) => s.name === "interrupt.issued");
  const lastInterruptAt =
    interrupts.length > 0 ? new Date(interrupts[interrupts.length - 1].at).toISOString().slice(11, 23) : null;
  const cancellations = telemetry.all.filter((s) => s.name === "turn.fenced");
  const lastCancelAt =
    cancellations.length > 0 ? new Date(cancellations[cancellations.length - 1].at).toISOString().slice(11, 23) : null;
  const s = e.summary;

  return (
    <div>
      <dl className="eval-section">
        <div className="eval-row">
          <dt>turn / generation</dt>
          <dd>
            {e.turnId} · {e.generationId}
          </dd>
        </div>
        <div className="eval-row">
          <dt>conversation state</dt>
          <dd data-testid="eval-state">{e.state}</dd>
        </div>
        <div className="eval-row">
          <dt>provider</dt>
          <dd className={e.provider === "fallback" ? "danger" : ""}>{e.provider}</dd>
        </div>
        <div className="eval-row">
          <dt>voice</dt>
          <dd>{e.voice}</dd>
        </div>
        <div className="eval-row">
          <dt>intent provider</dt>
          <dd>{e.intentProvider || "—"}</dd>
        </div>
      </dl>

      <dl className="eval-section">
        <div className="eval-row">
          <dt>tool latency</dt>
          <dd>{toolLatency != null ? `${toolLatency} ms` : "—"}</dd>
        </div>
        <div className="eval-row">
          <dt>closure latency</dt>
          <dd>{closureLatency != null ? `${closureLatency} ms` : "—"}</dd>
        </div>
        <div className="eval-row">
          <dt>synthesis latency</dt>
          <dd>{synthLatency != null ? `${synthLatency} ms` : "—"}</dd>
        </div>
        <div className="eval-row">
          <dt>active language</dt>
          <dd>en-US</dd>
        </div>
        <div className="eval-row">
          <dt>playback engine</dt>
          <dd data-testid="eval-playback">{e.provider === "fallback" ? "speechSynthesis" : "WebAudio · wav"}</dd>
        </div>
      </dl>

      <dl className="eval-section">
        <div className="eval-row">
          <dt>last interrupt</dt>
          <dd>{lastInterruptAt ?? "—"}</dd>
        </div>
        <div className="eval-row">
          <dt>last cancellation</dt>
          <dd>{lastCancelAt ?? "—"}</dd>
        </div>
        <div className="eval-row">
          <dt>interruptions measured</dt>
          <dd>{s.interruptions}</dd>
        </div>
        <div className="eval-row">
          <dt>audio-stop latency (avg)</dt>
          <dd>{s.audioStopLatencyMs.avg ?? "—"} ms</dd>
        </div>
        <div className="eval-row">
          <dt>interrupt→listening (avg)</dt>
          <dd>{s.speechToListeningMs.avg ?? "—"} ms</dd>
        </div>
        <div className="eval-row">
          <dt>stale-response suppression</dt>
          <dd className={s.staleSuppressedRate === 100 ? "" : "metric-bad"}>
            {s.staleSuppressed}/{s.interruptions} ({s.staleSuppressedRate ?? 0}%)
          </dd>
        </div>
        <div className="eval-row">
          <dt>stale tool results rejected</dt>
          <dd>{staleRejected}</dd>
        </div>
        <div className="eval-row">
          <dt>recovery rate</dt>
          <dd className={s.recoveryOkRate === null || s.recoveryOkRate >= 100 ? "" : "metric-bad"}>
            {s.recoveryOk}/{s.interruptions} ({s.recoveryOkRate ?? 0}%)
          </dd>
        </div>
        <div className="eval-row">
          <dt>obsolete audio fenced</dt>
          <dd>{fencedSamples.length}</dd>
        </div>
      </dl>

      {s.interruptions > 0 && (
        <div className="eval-section">
          <p className="label" style={{ margin: "0 0 var(--space-2)" }}>
            raw interruption timings (ms)
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-muted)", display: "grid", gap: 2 }}>
            {s.audioStopLatencyMs.raw?.map((ms, i) => (
              <li key={i}>
                #{i + 1}: audio-stop {ms} ms · stale suppressed{" "}
                {e.summary.interruptions > i ? "yes" : "?"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="eval-section">
        <p className="label" style={{ margin: 0 }}>
          live input level · {Math.round(vm.level * 100)}%
        </p>
      </div>
    </div>
  );
}