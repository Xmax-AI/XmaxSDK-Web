import { RoomMessageCodec } from "../src/Stream/Room/RoomMessageCodec";

/** Simulates a service ACK only after a complete logical command has been reassembled. */
export function createRoomCommandPeer(reply: (message: string) => void) {
  const trtc = new RoomMessageCodec();
  const agora = new RoomMessageCodec("__agora_chunk__");
  const counts = new Map<string, number>();
  return (raw: string) => {
    const envelope = JSON.parse(raw);
    const message = (envelope.event === "__agora_chunk__" ? agora : trtc).processIncoming("client", raw) as Record<string, unknown> | undefined;
    if (!message || !["start", "change_condition", "change_target_size"].includes(String(message.event)) || typeof message.xid !== "string") return;
    const count = (counts.get(message.xid) ?? 0) + 1;
    counts.set(message.xid, count);
    reply(JSON.stringify({ event: "xid_ack", xid: message.xid, count }));
  };
}
