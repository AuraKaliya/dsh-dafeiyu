const sensitiveKey = /^(?:password|passwd|pwd|secret|clientsecret|apikey|apitoken|token|authtoken|accesstoken|refreshtoken|idtoken|authorization|proxyauthorization|cookie|setcookie|credentials|reasoning|thinking|chainofthought|密码|口令)$/i;
/** Conservative known-secret masking, not an authorization decision or a universal secret detector. */
export function redactText(text) {
    let value = text
        .replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, '$1[REDACTED]@')
        .replace(/\bsk-[a-z0-9_-]{8,}/gi, '[REDACTED]')
        .replace(/\bBearer\s+[a-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:set-cookie|cookie|authorization)\s*:\s*[^\r\n]+/gi, '[REDACTED HEADER]')
        .replace(/((?:password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|token|密码|口令)["']?\s*[:=：]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|\[REDACTED\](?=$|[\s,;}\]])|[^\s,;}\]]+)/gi, '$1[REDACTED]');
    return { value, redacted: value !== text };
}
export function redactJson(input) {
    let changed = false;
    const visit = (value) => {
        if (typeof value === 'string') {
            const result = redactContent(value);
            changed ||= result.redacted;
            return result.value;
        }
        if (Array.isArray(value))
            return value.map(visit);
        if (value && typeof value === 'object')
            return Object.fromEntries(Object.entries(value).map(([key, child]) => {
                if (sensitiveKey.test(key.replace(/[_\s-]/g, ''))) {
                    changed ||= child !== '[REDACTED]';
                    return [key, '[REDACTED]'];
                }
                return [key, visit(child)];
            }));
        return value;
    };
    return { value: visit(input), redacted: changed };
}
/** Parse complete JSON before redaction, so a credential cannot leak across text page boundaries. */
export function redactContent(text) {
    try {
        const parsed = JSON.parse(text, (_key, value, context) => typeof value === 'number' && !Number.isSafeInteger(value) && context?.source ? context.source : value);
        if (parsed === null || typeof parsed !== 'object')
            return redactText(text);
        const result = redactJson(parsed);
        return result.redacted ? { value: JSON.stringify(result.value, null, 2), redacted: true } : { value: text, redacted: false };
    }
    catch {
        return redactText(text);
    }
}
