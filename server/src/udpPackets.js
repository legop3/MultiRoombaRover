import { CONTROL_CONSTANTS } from './constants.js';
import { checksum8 } from './checksum.js';

const CONTROL_PACKET_SIZE = 12;

export function buildControlPacket(state) {
  const buffer = Buffer.allocUnsafe(CONTROL_PACKET_SIZE);
  buffer.writeUInt8(CONTROL_CONSTANTS.MAGIC, 0);
  buffer.writeUInt8(CONTROL_CONSTANTS.VERSION, 1);
  buffer.writeUInt16LE(state.seq & 0xffff, 2);
  buffer.writeInt16LE(state.leftMmps, 4);
  buffer.writeInt16LE(state.rightMmps, 6);
  buffer.writeUInt8(state.mode ?? CONTROL_CONSTANTS.MODES.NO_CHANGE, 8);
  buffer.writeUInt8(state.actions ?? 0, 9);
  buffer.writeUInt8(state.songSlot ?? 0, 10);
  buffer.writeUInt8(checksum8(buffer, CONTROL_PACKET_SIZE - 1), 11);
  return buffer;
}
