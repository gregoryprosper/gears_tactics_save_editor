import type { SaveObject, SaveObjectRef } from './types';
export class ObjectResolver {
  constructor(private readonly objects: SaveObject[]) {}
  resolve(index: number): SaveObjectRef {
    const object = this.objects[index];
    return object
      ? { index, name: object.name, classPath: object.classPath, outerPath: object.outerPath }
      : { index };
  }
  children(index: number): SaveObject[] {
    return this.objects.filter((o) => o.body?.outerIndex === index);
  }
}
