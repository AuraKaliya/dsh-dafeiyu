import { z } from 'zod';
export declare const QqMessageSequenceSchema: z.ZodObject<{
    qq_messages: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"media">;
    }, z.core.$strict>], "type">>;
}, z.core.$strict>;
export declare const QQ_EXPRESSION_DEFAULTS = "QQ\u662F\u5373\u65F6\u804A\u5929\uFF1A\u6309\u4E00\u4E2A\u5B8C\u6574\u610F\u601D\u7EC4\u7EC7\u6BCF\u6761\u6D88\u606F\uFF0C\u6BCF\u6761\u901A\u5E38\u51E0\u53E5\u8BDD\uFF0C\u53EF\u4EE5\u4E00\u6761\u3001\u591A\u6761\u6216\u7EAF\u8868\u60C5\uFF1B\u4E0D\u5F3A\u62C6\u53E5\u3001\u4E0D\u673A\u68B0\u8F6E\u6D41\u3001\u4E0D\u5236\u9020\u9519\u522B\u5B57\u3002\u666E\u901A\u95F2\u804A\u5C11\u7528\u6807\u9898\u3001\u7F16\u53F7\u548C\u62A5\u544A\u53E3\u543B\uFF1B\u9700\u8981\u8BE6\u7EC6\u89E3\u91CA\u3001\u6587\u6863\u6216\u4EE3\u7801\u65F6\u4FDD\u7559\u5FC5\u8981\u7EC6\u8282\u3002\u9636\u6BB5\u4EA4\u6D41\u8003\u8651\u5BF9\u65B9\u7684\u5B9E\u9645\u9700\u8981\uFF0C\u8BF4\u660E\u6709\u4F9D\u636E\u7684\u8FDB\u5C55\u548C\u963B\u788D\u3002\u4E34\u65F6\u8868\u8FBE\u8981\u6C42\u4E0E\u5F53\u524D\u573A\u666F\u4F18\u5148\uFF1B\u6709\u4EF7\u503C\u7684\u957F\u671F\u504F\u597D\u53EF\u4EE5\u9009\u62E9\u4FDD\u5B58\u5E76\u7EE7\u7EED\u8C03\u6574\u3002";
export declare const QQ_SEQUENCE_INSTRUCTIONS: string;
/** Only a complete, explicitly marked envelope changes transport semantics. Newlines remain prose. */
export declare function qqMessageSequence(raw: string): {
    messages: string[];
    mediaAt: number;
    structured: boolean;
};
export declare const qqVisibleText: (raw: string) => string;
