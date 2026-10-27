import { z } from 'zod';
/** Model judgments are persisted separately from execution facts and delivery receipts. */
export declare const TaskAssessmentSchema: z.ZodObject<{
    goalStatus: z.ZodEnum<{
        met: "met";
        partial: "partial";
        unmet: "unmet";
        uncertain: "uncertain";
    }>;
    summary: z.ZodString;
    evidenceIds: z.ZodDefault<z.ZodArray<z.ZodUUID>>;
    limitations: z.ZodArray<z.ZodString>;
    unfinished: z.ZodArray<z.ZodString>;
    requiredCapabilities: z.ZodDefault<z.ZodArray<z.ZodString>>;
    retainExperience: z.ZodDefault<z.ZodBoolean>;
    next: z.ZodEnum<{
        deliver: "deliver";
        continue: "continue";
        wait: "wait";
        "capability-change": "capability-change";
    }>;
}, z.core.$strict>;
export type TaskAssessment = z.infer<typeof TaskAssessmentSchema>;
export declare const PhaseTimeoutsSchema: z.ZodPrefault<z.ZodObject<{
    assessment: z.ZodDefault<z.ZodNumber>;
    render: z.ZodDefault<z.ZodNumber>;
    verification: z.ZodDefault<z.ZodNumber>;
    feedback: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>>;
export declare function outputContract(schema: z.ZodType): z.core.ZodStandardJSONSchemaPayload<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
