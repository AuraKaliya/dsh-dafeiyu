import { z } from 'zod';
import { GroupListSchema } from './groups.js';
/** The verified read-only joined-group query. No caller-supplied command or payload. */
export const SNOWLUMA_GROUP_LIST_REQUEST = Object.freeze({
    cmd: 'OidbSvcTrpcTcp.0xfe5_2',
    data: '08e51f1002220e0a0c0a06180120012801120238016001',
    rsp: true,
});
const responseHex = z.string().min(2).max(2 * 1024 ** 2).regex(/^(?:[0-9a-fA-F]{2})+$/);
const utf8 = new TextDecoder('utf-8', { fatal: true });
/** Bounded protobuf reader: unknown fields are skipped, never interpreted as executable input. */
function fields(data) {
    let offset = 0, count = 0;
    const result = new Map();
    const read = () => {
        let value = 0n;
        for (let i = 0; i < 10; i++) {
            const byte = data[offset++];
            if (byte === undefined || i === 9 && byte > 1)
                throw new Error('GROUP_RESPONSE_INVALID');
            value |= BigInt(byte & 127) << BigInt(i * 7);
            if (!(byte & 128))
                return value;
        }
        throw new Error('GROUP_RESPONSE_INVALID');
    };
    while (offset < data.length) {
        if (++count > 16384)
            throw new Error('GROUP_RESPONSE_INVALID');
        const tag = read(), id = Number(tag >> 3n), wire = Number(tag & 7n);
        if (id < 1 || id > 536870911)
            throw new Error('GROUP_RESPONSE_INVALID');
        let field;
        if (wire === 0)
            field = { wire, value: read() };
        else if (wire === 1 || wire === 2 || wire === 5) {
            const size = wire === 2 ? read() : BigInt(wire === 1 ? 8 : 4);
            if (size > BigInt(data.length - offset))
                throw new Error('GROUP_RESPONSE_INVALID');
            field = { wire, value: data.subarray(offset, offset + Number(size)) };
            offset += Number(size);
        }
        else
            throw new Error('GROUP_RESPONSE_INVALID');
        const values = result.get(id) ?? [];
        values.push(field);
        result.set(id, values);
    }
    return result;
}
function single(source, id) {
    const values = source.get(id) ?? [];
    if (values.length > 1)
        throw new Error('GROUP_RESPONSE_INVALID');
    return values[0];
}
function uint(source, id) {
    const field = single(source, id);
    if (field && field.wire !== 0)
        throw new Error('GROUP_RESPONSE_INVALID');
    return field?.value;
}
function bytes(source, id) {
    const field = single(source, id);
    if (field && field.wire !== 2)
        throw new Error('GROUP_RESPONSE_INVALID');
    return field?.value;
}
/** Missing/unknown mask values retain membership but cannot grant group access. */
export function parseSnowLumaGroups(raw) {
    try {
        const envelope = fields(Buffer.from(responseHex.parse(raw), 'hex'));
        const command = uint(envelope, 1), subcommand = uint(envelope, 2), error = uint(envelope, 3);
        if (command !== undefined && command !== 4069n || subcommand !== undefined && subcommand !== 2n || error !== undefined && error !== 0n)
            throw new Error('GROUP_RESPONSE_INVALID');
        const body = bytes(envelope, 4);
        if (body === undefined)
            throw new Error('GROUP_RESPONSE_INVALID');
        const groups = fields(body).get(2) ?? [];
        if (groups.length > 2000)
            throw new Error('GROUP_RESPONSE_INVALID');
        return GroupListSchema.parse(groups.map(entry => {
            if (entry.wire !== 2)
                throw new Error('GROUP_RESPONSE_INVALID');
            const group = fields(entry.value), id = uint(group, 3);
            if (id === undefined || id < 1n || id > 4294967295n)
                throw new Error('GROUP_RESPONSE_INVALID');
            const info = bytes(group, 4), settings = bytes(group, 5);
            const name = info === undefined ? undefined : bytes(fields(info), 5);
            const mask = settings === undefined ? undefined : uint(fields(settings), 7);
            return { id: String(id), name: name === undefined ? '' : utf8.decode(name),
                msgMask: mask === 1n || mask === 2n || mask === 3n || mask === 4n ? Number(mask) : null };
        }));
    }
    catch {
        throw new Error('GROUP_RESPONSE_INVALID');
    }
}
