import { z } from 'zod';

/**
 * XYWH represents the x, y, width, and height of an element or block.
 */
export type XYWH = [number, number, number, number];

/**
 * SerializedXYWH is a string that represents the x, y, width, and height of a block.
 */
export type SerializedXYWH = `[${number},${number},${number},${number}]`;

export const SerializedXYWHZodSchema = z.custom<SerializedXYWH>((val: any) => {
  if (typeof val !== 'string') {
    throw new Error('SerializedXYWH should be a string');
  }

  if (!val.startsWith('[') || !val.endsWith(']')) {
    throw new Error('SerializedXYWH should be wrapped in square brackets');
  }

  const parts = val.slice(1, -1).split(',');

  if (parts.length !== 4) {
    throw new Error('SerializedXYWH should have 4 parts');
  }

  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      throw new Error('Each part of SerializedXYWH should be a number');
    }
  }

  return val as SerializedXYWH;
});

export function serializeXYWH(
  x: number,
  y: number,
  w: number,
  h: number
): SerializedXYWH {
  return `[${x},${y},${w},${h}]`;
}

export function deserializeXYWH(xywh: string): XYWH {
  try {
    return JSON.parse(xywh) as XYWH;
  } catch (e) {
    console.error('Failed to deserialize xywh', xywh);
    console.error(e);

    return [0, 0, 0, 0];
  }
}
