import { z } from 'zod';
import { BoundedProcess } from './process.js';
export declare const documentConfigSchema: z.ZodObject<{
    python: z.ZodString;
    pypdfVersion: z.ZodLiteral<"6.10.0">;
}, z.core.$strict>;
export declare class DocumentReader {
    private readonly root;
    private readonly allowed;
    private readonly config;
    private readonly worker;
    constructor(root: string, allowed: string, config: z.output<typeof documentConfigSchema>, worker?: BoundedProcess);
    read(input: {
        file: string;
        name: string;
        offset: number;
        textOffset: number;
        limit: number;
    }, signal: AbortSignal, guard: () => void): Promise<{
        schemaVersion: 1;
        kind: "text" | "json" | "csv" | "pdf" | "docx" | "xlsx";
        sha256: string;
        bytes: number;
        units: {
            kind: "page" | "paragraph" | "row";
            locator: string;
            text: string;
            index: number;
            textStart: number;
            textEnd: number;
            cachedFormula?: boolean | undefined;
        }[];
        next: {
            offset: number;
            textOffset: number;
        } | null;
        totalUnits: number | null;
        gaps: string[];
    }>;
}
