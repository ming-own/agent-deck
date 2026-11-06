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

import custom from '@/assets/agent/custom.png';
import documentArt from '@/assets/agent/document.png';
import owl from '@/assets/agent/owl.png';
import oasis from '@/assets/cards/archive-jade.webp';
import dragon from '@/assets/cards/dragon-amethyst.webp';
import crab from '@/assets/cards/guardian-sapphire.webp';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { defaultCardDesign, type CardDesign } from '@/service/cardDesign';
import { Bot, Brain, Clock3, FileText, Workflow } from 'lucide-react';
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
  category = 'agent',
  footer,
  children,
}: {
  design?: Partial<CardDesign> | null;
  name: string;
  description?: string;
  model?: string;
  skills?: number;
  workforce?: boolean;
  category?: 'agent' | 'context' | 'memory' | 'automation';
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const d = defaultCardDesign(design);
  const [squareArtwork, setSquareArtwork] = useState(false);
  const resource = category !== 'agent';
  const categoryIcon = {
    agent: workforce ? Workflow : Bot,
    context: FileText,
    memory: Brain,
    automation: Clock3,
  }[category];
  const title = d.title || name;
  const summary =
    d.summary || description || t('chat.session-agents-default-role');
  return (
    <div
      className={`agent-card-face agent-card-face--${d.material} agent-card-face--${d.layout} agent-card-face--${category}`}
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
        <h3 className="agent-card-title min-w-0 truncate" title={title}>
          {title}
        </h3>
        <span className="agent-card-seal">
          <DsIcon icon={categoryIcon} />
        </span>
      </div>
      <DsText role="meta" className="agent-card-category">
        {t(
          category === 'automation'
            ? 'chat.card-category-trigger'
            : resource
              ? 'chat.card-category-knowledge'
              : 'chat.card-category-agent'
        )}{' '}
        ·{' '}
        {resource
          ? t('chat.workspace-' + category)
          : workforce
            ? 'Workforce'
            : 'Agent'}
      </DsText>
      <div className="agent-card-rules">
        <DsText role="meta" weight="semibold">
          {t(
            resource
              ? 'chat.workspace-' + category
              : workforce
                ? 'chat.card-team-capability'
                : 'chat.card-capability-summary'
          )}
        </DsText>
        <span className="agent-card-summary" title={summary}>
          {summary}
        </span>
        <div className="agent-card-stats">
          <DsText role="meta" className="min-w-0 truncate" title={model}>
            {resource
              ? t('chat.workspace-title')
              : model || t('chat.card-model-later')}
          </DsText>
          <DsText role="meta" className="shrink-0">
            {resource
              ? t('chat.workspace-' + category)
              : workforce
                ? 'Workforce'
                : `${skills} Skills`}
          </DsText>
        </div>
        {footer && <div className="agent-card-actions">{footer}</div>}
      </div>
      {children}
    </div>
  );
}
