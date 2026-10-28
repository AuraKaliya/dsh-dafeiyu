import { createHash } from 'node:crypto';
import { ContextItemSchema } from '#dafeiyu/contracts';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Required bounded index, not a replacement for authoritative Task records or full goals. */
export function situationContributor(enabled, read, record, historical) {
    const views = new WeakMap();
    return { id: 'responsibilities', kind: 'operational-fact', prepare: async (request) => {
            if (!enabled())
                return [];
            const rows = read(request.conversation), map = new Map();
            const items = rows.slice(0, 6).map(row => { row.guard(); const item = ContextItemSchema.parse({ id: row.id, version: row.version, text: JSON.stringify(row.data), expiresAt: '9999-12-31T23:59:59.999Z', sources: [{ ref: 'dafeiyu:responsibility:' + row.id, version: row.version, hash: hash(row.data) }] }); record(request, item, row.proof); map.set(item.id, { hash: hash(item), guard: row.guard }); return item; });
            views.set(request, map);
            return items;
        }, validate: (request, item) => { const view = views.get(request)?.get(item.id); if (!view || view.hash !== hash(item))
            return false; try {
            view.guard();
            return true;
        }
        catch {
            return false;
        } }, validateHistorical: historical };
}
