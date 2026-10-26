export function conversationHistory(item) { return { id: item.id, route: item.route, sessionId: item.sessionId, inputKind: 'user', inputSourceId: item.message.id }; }
