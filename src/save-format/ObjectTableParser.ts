import { findProperty, structArray } from './PropertyParser';
import type { SaveObject, UnrealProperty } from './types';
export function parseObjectTable(buffer: Buffer, property: UnrealProperty): SaveObject[] {
  return structArray(buffer, property).map((props, index) => {
    const string = (key: string): string => {
      const prop = findProperty(props, key);
      if (prop?.type !== 'StrProperty' || typeof prop.value !== 'string')
        throw new Error(`Object ${index}: missing ${key}`);
      return prop.value;
    };
    return {
      index,
      name: string('Name'),
      classPath: string('ClassPath'),
      outerPath: string('OuterPath'),
      flags: String(findProperty(props, 'Flags')?.value ?? 'unknown'),
      properties: [],
      frames: [],
    };
  });
}
