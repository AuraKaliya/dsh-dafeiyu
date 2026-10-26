const afterName = /^(?:$|\s|[，,。.!！?？:：;；、]|你|请|帮|能不能|可以|在吗|来|看看|早上好|晚上好|你好|晚安)/u;
const beforeMention = /[\s，,。.!！?？:：;；、]/u;
/** Mechanical address matching only; quoted evidence and nicknames never become invocation authority. */
export function naturallyAddressed(text, names) {
    if (!names.length)
        return false;
    let fence = null;
    for (const rawLine of text.split(/\r?\n/u)) {
        const marker = rawLine.trimStart().match(/^(`{3,}|~{3,})/u)?.[1];
        if (marker) {
            if (!fence)
                fence = marker[0];
            else if (marker[0] === fence)
                fence = null;
            continue;
        }
        if (fence || /^\s*>/u.test(rawLine))
            continue;
        const line = rawLine.replace(/`[^`]*`|“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/gu, ' ');
        const leading = line.replace(/^[\s，,。.!！?？:：;；、]+/u, '');
        for (const name of names) {
            if (leading.startsWith(name) && afterName.test(leading.slice(name.length)))
                return true;
            let from = 0;
            while (from < line.length) {
                const at = line.indexOf('@' + name, from);
                if (at < 0)
                    break;
                if ((at === 0 || beforeMention.test(line[at - 1])) && afterName.test(line.slice(at + name.length + 1)))
                    return true;
                from = at + name.length + 1;
            }
        }
    }
    return false;
}
