/** The dedicated CLI's declared text surface. Tool structure and replay reasoning tags are not image/file input. */
const TEXT_CONTENT_TYPES = new Set(['text', 'reasoning', 'tool-call', 'tool-addition', 'tool-removal']);
export function assertHeadlessTextRequest(input) {
    if (!input || typeof input !== 'object' || !('messages' in input) || !Array.isArray(input.messages))
        throw new Error('EXECUTOR_NON_TEXT_INPUT_DENIED');
    const messages = input.messages;
    for (const message of messages) {
        if (!message || typeof message !== 'object' || !('content' in message) || !Array.isArray(message.content))
            throw new Error('EXECUTOR_NON_TEXT_INPUT_DENIED');
        const content = message.content;
        for (const block of content) {
            if (!block || typeof block !== 'object' || !('type' in block) || typeof block.type !== 'string' || !TEXT_CONTENT_TYPES.has(block.type))
                throw new Error('EXECUTOR_NON_TEXT_INPUT_DENIED');
        }
    }
}
