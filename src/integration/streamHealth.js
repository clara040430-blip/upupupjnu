/**
 * Packet sequencing and receive-time freshness for each independent board.
 * Sender timestamps are NOT trusted as local wall-clock timestamps.
 */
export const TELEMETRY_STALE_AFTER_MS = 5000;

export function acceptNextPacket(previous, packet, receivedAtMs) {
  if (!Number.isFinite(receivedAtMs)) return { accepted: false, reason: '수신 시각 오류' };
  if (previous && (
    packet.sampleCount <= previous.packet.sampleCount ||
    packet.timestampMs < previous.packet.timestampMs
  )) return { accepted: false, reason: '중복·역순 패킷' };
  return { accepted: true, frame: { packet, receivedAtMs } };
}

export function freshFrames(frames, nowMs, maxAgeMs = TELEMETRY_STALE_AFTER_MS) {
  return Object.fromEntries(Object.entries(frames).filter(([, frame]) =>
    frame && Number.isFinite(frame.receivedAtMs) &&
    nowMs >= frame.receivedAtMs && nowMs - frame.receivedAtMs <= maxAgeMs
  ));
}

export function hasStaleFrame(frames, boardId, nowMs) {
  const frame = frames[boardId];
  return !!frame && !(boardId in freshFrames({ [boardId]: frame }, nowMs));
}
