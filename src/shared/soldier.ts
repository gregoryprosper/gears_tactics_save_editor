/** Package-local references never denote destination object-table indices. */
export type SoldierNode =
  | { kind: 'native'; hex: string }
  | { kind: 'reference'; id: string }
  | { kind: 'preserve'; name: string }
  | { kind: 'property'; name: string; type: string; tagHex: string; payload: SoldierNode[] };

export interface SoldierSummary {
  displayName: string;
  combatClass: string;
  classInferred: boolean;
  hero?: string;
  callsign?: string;
  stats: Record<string, number>;
  skills: { slot: number; status: string; ability?: string }[];
}
export interface SoldierPackage {
  format: 'gears-tactics-soldier';
  version: 1;
  // Explicitly not a promise that all native dependencies have been decoded.
  completeness: 'native-dependencies-unverified';
  source: {
    saveVersion: number;
    packageVersion: number;
    engineVersion: string;
    gameType: string;
    gameState: string;
    customVersions: { guid: string; version: number }[];
  };
  soldier: SoldierSummary;
  root: string;
  objects: {
    id: string;
    name: string;
    classPath: string;
    outerPath: string;
    flags: string;
    outer: string | null;
    body: SoldierNode[];
  }[];
  bindings: {
    id: string;
    role: 'campaign' | 'roster' | 'inventory' | 'other-character' | 'unresolved';
    classPath: string;
    name: string;
  }[];
  inventoryDefinitions?: {
    guid: string;
    category: 'armour' | 'mod' | 'cosmetic';
    inventoryClass: string;
    assetIdentity?: string;
  }[];
  weaponDefinitions?: { id: string; kind: number; flag: number; level: number }[];
}

export interface SoldierImportPreview {
  token: string;
  revision: number;
  soldier: SoldierSummary;
  objectCount: number;
  blockers: string[];
  add: { blockers: string[] };
  replacements: { objectIndex: number; displayName: string; blockers: string[] }[];
  canApply: boolean;
}
