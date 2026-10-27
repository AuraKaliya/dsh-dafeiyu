import assert from 'node:assert/strict';

export interface GroupPacketFixture { group_id: number | string; group_name: string; msgMask?: number | null }
export function wireUint(field: number, input: number | bigint): Buffer {
  const encode = (value: bigint): Buffer => {
    const bytes: number[] = [];
    do { const low = Number(value & 127n); value >>= 7n; bytes.push(low | (value ? 128 : 0)); } while (value);
    return Buffer.from(bytes);
  };
  return Buffer.concat([encode(BigInt(field * 8)), encode(BigInt(input))]);
}
export function wireBytes(field: number, bytes: Uint8Array): Buffer {
  const tag = wireUint(field, bytes.length); tag[0] = tag[0]! | 2;
  return Buffer.concat([tag, bytes]);
}
/** Test platform encoder, independent of the production decoder and its fixed request. */
export function groupPacket(groups: readonly GroupPacketFixture[]): string {
  const body = Buffer.concat(groups.map(group => wireBytes(2, Buffer.concat([
    wireUint(3, BigInt(group.group_id)), wireBytes(4, wireBytes(5, Buffer.from(group.group_name))),
    wireBytes(5, group.msgMask === null ? Buffer.alloc(0) : wireUint(7, group.msgMask ?? 1)),
  ]))));
  return Buffer.concat([wireUint(1, 4069), wireUint(2, 2), wireBytes(4, body)]).toString('hex');
}
export function assertGroupQuery(raw: string): void {
  assert.deepEqual(JSON.parse(raw), { cmd: 'OidbSvcTrpcTcp.0xfe5_2', data: '08e51f1002220e0a0c0a06180120012801120238016001', rsp: true });
}
