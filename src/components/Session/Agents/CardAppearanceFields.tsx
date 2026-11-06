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

import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { Textarea } from '@/components/ui/textarea';
import {
  cardArtworks,
  readCardArtwork,
  type CardDesign,
} from '@/service/cardDesign';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cardArtworkSources } from './CardFace';

export function CardPicker({
  label,
  value,
  items,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  items: { id: string; name: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        title={label}
        aria-label={label}
        size="sm"
        wrapperClassName="w-full"
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent fitTrigger>
        {items.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CardAppearanceFields({
  value,
  onChange,
  disabled = false,
  onUploadingChange,
}: {
  value: CardDesign;
  onChange: (design: CardDesign) => void;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const { t } = useTranslation();
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false),
    [error, setError] = useState(false);
  return (
    <fieldset
      disabled={disabled || uploading}
      className="m-0 flex min-w-0 flex-col gap-ds-16 border-0 border-x-0 border-y-0 p-0"
    >
      <DsText role="base" weight="semibold">
        {t('chat.card-information')}
      </DsText>
      <Input
        title={t('chat.card-title')}
        aria-label={t('chat.card-title')}
        value={value.title}
        maxLength={100}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
      />
      <Textarea
        variant="outlined"
        title={t('chat.card-capability-summary')}
        aria-label={t('chat.card-capability-summary')}
        value={value.summary}
        maxLength={400}
        onChange={(e) => onChange({ ...value, summary: e.target.value })}
      />
      <DsText role="base" weight="semibold" className="card-form-section-title">
        {t('chat.card-artwork-and-frame')}
      </DsText>
      <div className="card-artwork-grid">
        {cardArtworks.map((art) => (
          <button
            type="button"
            key={art}
            className={'card-artwork-choice ' + DS_FOCUS_RING}
            aria-label={t('chat.card-art-' + art)}
            aria-pressed={!value.image_data && value.artwork === art}
            onClick={() =>
              onChange({ ...value, artwork: art, image_data: null })
            }
          >
            <img src={cardArtworkSources[art]} alt="" />
            <DsText role="meta">{t('chat.card-art-' + art)}</DsText>
          </button>
        ))}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label={t('chat.card-upload')}
        onChange={async (e) => {
          const selected = e.target.files?.[0];
          e.target.value = '';
          if (!selected) return;
          setUploading(true);
          onUploadingChange?.(true);
          setError(false);
          try {
            const image_data = await readCardArtwork(selected);
            onChange({ ...value, image_data });
          } catch {
            setError(true);
          } finally {
            setUploading(false);
            onUploadingChange?.(false);
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => file.current?.click()}
      >
        <DsIcon icon={Upload} />
        {t(uploading ? 'chat.card-uploading' : 'chat.card-upload')}
      </Button>
      {value.image_data && (
        <DsText role="meta">{t('chat.card-custom-artwork')}</DsText>
      )}
      {error && (
        <DsText
          role="meta"
          className="text-ds-error-default"
          aria-live="assertive"
        >
          {t('chat.card-artwork-invalid')}
        </DsText>
      )}
      <div
        className="flex flex-col gap-ds-8"
        role="group"
        aria-label={t('chat.card-layout')}
      >
        <DsText role="meta">{t('chat.card-layout')}</DsText>
        <div className="card-layout-options">
          {(['full', 'classic'] as const).map((layout) => (
            <Button
              type="button"
              key={layout}
              size="sm"
              variant={value.layout === layout ? 'secondary' : 'ghost'}
              aria-pressed={value.layout === layout}
              onClick={() => onChange({ ...value, layout })}
            >
              {t('chat.card-layout-' + layout)}
            </Button>
          ))}
        </div>
      </div>
      <div
        className="flex flex-col gap-ds-8"
        role="group"
        aria-label={t('chat.card-material')}
      >
        <DsText role="meta">{t('chat.card-material')}</DsText>
        <div className="card-material-options">
          {(['gold', 'silver', 'ink'] as const).map((material) => (
            <Button
              type="button"
              key={material}
              size="sm"
              variant={value.material === material ? 'secondary' : 'ghost'}
              aria-pressed={value.material === material}
              onClick={() => onChange({ ...value, material })}
            >
              <span
                aria-hidden="true"
                className={
                  'card-material-swatch card-material-swatch--' + material
                }
              />
              {t('chat.card-material-' + material)}
            </Button>
          ))}
        </div>
      </div>
      <DsText role="meta" className="text-ds-ink-muted-default">
        {t('chat.card-appearance-independent')}
      </DsText>
    </fieldset>
  );
}
