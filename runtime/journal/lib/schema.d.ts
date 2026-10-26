import { DatabaseSync } from 'node:sqlite';
export declare const JOURNAL_APPLICATION_ID = 1145457202;
export interface JournalInspection {
    exists: boolean;
    version: number;
    applicationId: number;
    supported: boolean;
    activeOwner: boolean;
}
export declare function journalHasLiveOwner(db: DatabaseSync): boolean;
export declare function checkJournalShape(db: DatabaseSync, allowEarlyV1?: boolean): void;
export declare function inspectJournal(file: string): JournalInspection;
export declare function migrateJournalSchema(db: DatabaseSync): void;
