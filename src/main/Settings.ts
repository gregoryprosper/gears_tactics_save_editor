import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from '../shared/api';
export const defaultSettings: Settings = {
  developerMode: false,
  experimentalEditing: false,
  abilityPointsMaximum: 2147483647,
};
export function validateSettings(value: unknown): Settings {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid settings');
  const data = value as Record<string, unknown>;
  if (
    typeof data.developerMode !== 'boolean' ||
    typeof data.experimentalEditing !== 'boolean' ||
    typeof data.abilityPointsMaximum !== 'number' ||
    !Number.isInteger(data.abilityPointsMaximum) ||
    data.abilityPointsMaximum < 0 ||
    data.abilityPointsMaximum > 2147483647
  )
    throw new Error('Ability point maximum must be an integer between 0 and 2147483647');
  return {
    developerMode: data.developerMode,
    experimentalEditing: data.experimentalEditing,
    abilityPointsMaximum: data.abilityPointsMaximum,
  };
}
export class SettingsStore {
  settings = { ...defaultSettings };
  lastDirectory?: string;
  constructor(private readonly directory: string) {}
  async load(): Promise<void> {
    try {
      const data: unknown = JSON.parse(
        await readFile(join(this.directory, 'settings.json'), 'utf8'),
      );
      const validated = validateSettings(data);
      this.settings = validated;
      if (
        data &&
        typeof data === 'object' &&
        'lastDirectory' in data &&
        typeof data.lastDirectory === 'string'
      )
        this.lastDirectory = data.lastDirectory;
    } catch {
      /* Missing or invalid preferences never prevent opening the app. */
    }
  }
  async persist(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, 'settings.json');
    await writeFile(
      `${path}.tmp`,
      JSON.stringify({ ...this.settings, lastDirectory: this.lastDirectory }, null, 2),
      { mode: 0o600 },
    );
    await rename(`${path}.tmp`, path);
  }
}
