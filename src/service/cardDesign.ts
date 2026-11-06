// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

export const cardArtworks = [
  'dragon',
  'owl',
  'crab',
  'oasis',
  'document',
  'custom',
] as const;
export interface CardDesign {
  title: string;
  summary: string;
  artwork: (typeof cardArtworks)[number];
  image_data: string | null;
  layout: 'full' | 'classic';
  material: 'gold' | 'silver' | 'ink';
}
export function defaultCardDesign(
  value?: Partial<CardDesign> | null
): CardDesign {
  return {
    title: '',
    summary: '',
    artwork: 'dragon',
    image_data: null,
    layout: 'full',
    material: 'gold',
    ...value,
  };
}

/** Copy a bounded raster into the card so it survives reloads and template installs. */
export async function readCardArtwork(file: File): Promise<string> {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  )
    throw new Error('card-artwork-invalid');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const ratio = Math.min(
      1,
      1024 / Math.max(image.naturalWidth, image.naturalHeight)
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('card-artwork-invalid');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/webp', 0.85);
    if (
      data.length > 1_400_000 ||
      !/^data:image\/(png|jpeg|webp);base64,/.test(data)
    )
      throw new Error('card-artwork-invalid');
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
