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

import crab from '@/assets/agent/crab.png';
import custom from '@/assets/agent/custom.png';
import documentArt from '@/assets/agent/document.png';
import dragon from '@/assets/agent/dragon.png';
import oasis from '@/assets/agent/oasis.png';
import owl from '@/assets/agent/owl.png';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { defaultCardDesign, type CardDesign } from '@/service/cardDesign';
import { Bot, Workflow } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import './cardStudio.css';

export const cardArtworkSources = {
  dragon,
  owl,
  crab,
  oasis,
  document: documentArt,
  custom,
};

/** Same face in the library, designer and canvas. Execution stays with its owner. */
export function CardFace({
  design,
  name,
  description,
  model,
  skills = 0,
  workforce = false,
  footer,
  children,
}: {
  design?: Partial<CardDesign> | null;
  name: string;
  description?: string;
  model?: string;
  skills?: number;
  workforce?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const d = defaultCardDesign(design);
  const [squareArtwork, setSquareArtwork] = useState(!d.image_data);
  const title = d.title || name;
  const summary =
    d.summary || description || t('chat.session-agents-default-role');
  return (
    <div
      className={`agent-card-face agent-card-face--${d.material} agent-card-face--${d.layout}`}
    >
      <div
        className={
          'agent-card-art' + (squareArtwork ? ' agent-card-art--square' : '')
        }
        aria-hidden="true"
      >
        <img
          src={d.image_data || cardArtworkSources[d.artwork] || dragon}
          alt=""
          draggable={false}
          onLoad={(event) =>
            setSquareArtwork(
              event.currentTarget.naturalWidth >=
                event.currentTarget.naturalHeight * 0.9
            )
          }
        />
      </div>
      <div className="agent-card-heading">
        <DsText
          role="title"
          weight="semibold"
          className="min-w-0 truncate"
          title={title}
        >
          {title}
        </DsText>
        <DsIcon icon={workforce ? Workflow : Bot} />
      </div>
      <DsText role="meta" className="agent-card-category">
        {t('chat.card-category-agent')} · {workforce ? 'Workforce' : 'Agent'}
      </DsText>
      <div className="agent-card-rules">
        <DsText role="meta" weight="semibold">
          {t(
            workforce
              ? 'chat.card-team-capability'
              : 'chat.card-capability-summary'
          )}
        </DsText>
        <DsText role="meta" className="agent-card-summary" title={summary}>
          {summary}
        </DsText>
        <div className="agent-card-stats">
          <DsText role="meta" className="min-w-0 truncate" title={model}>
            {model || t('chat.card-model-later')}
          </DsText>
          <DsText role="meta" className="shrink-0">
            {workforce ? 'Workforce' : `${skills} Skills`}
          </DsText>
        </div>
        {footer && <div className="agent-card-actions">{footer}</div>}
      </div>
      {children}
    </div>
  );
}
