/** Lossless packaging after target/source admission. It never selects or authorizes content. */
export function packNativeEvidence(items) {
    if (items.length <= 19)
        return items;
    const packed = [];
    for (const kind of ['reported', 'inference']) {
        let group = [];
        const text = (values) => JSON.stringify({ kind: 'evidence-bundle', items: values.map(({ id, text }) => ({ id, text })) });
        const flush = () => { if (group.length) {
            packed.push({ id: 'B' + packed.length, kind, text: text(group) });
            group = [];
        } };
        for (const item of items.filter(item => item.kind === kind)) {
            if (text([...group, item]).length > 32000)
                flush();
            if (text([item]).length > 32000)
                packed.push({ ...item });
            else
                group.push(item);
        }
        flush();
    }
    if (packed.length > 19)
        throw new Error('NATIVE_EXPRESSION_CAPACITY');
    return packed;
}
