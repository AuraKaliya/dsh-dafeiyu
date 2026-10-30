export interface ProfileRepairResult {
  ready: boolean;
  faults: string[];
  declaredTarget: string;
  installedTarget: string | null;
  backup: string | null;
}
export function repairDshProfile(profileDirectory: string, options?: { repair?: boolean; alignPlugin?: boolean }): ProfileRepairResult;
