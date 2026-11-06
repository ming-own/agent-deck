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

import { readCardArtwork } from '@/service/cardDesign';
import type { sessionAgentApi } from '@/service/sessionAgentApi';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardDesigner, InstanceCardDesigner } from './CardDesigner';
import { LegacyWorkshop } from './LegacyWorkshop';
import { Workshop } from './Workshop';

vi.mock('./SkillPicker', () => ({ SkillPicker: () => <div>Skills</div> }));
vi.mock('./ToolPermissions', () => ({
  ToolPermissions: () => <div>Tools</div>,
}));

const api = (value: object) => value as ReturnType<typeof sessionAgentApi>;
const node = {
  id: 'agent-a',
  name: 'Original agent',
  revision: 4,
  card_revision: 2,
  model: {
    id: 'provider:1',
    name: 'Model',
    model_type: 'A',
    model_platform: 'openai',
  },
  role: 'Original role',
  instructions: 'Keep instructions',
  skill_ids: [],
  tool_policy: {},
  harness_id: 'standard',
  created_at: '',
  updated_at: '',
};

describe('card workshop boundaries', () => {
  it('finds a card by its visible title and announces that title', async () => {
    const template = {
      family: 'f',
      version: 1,
      name: 'Library record',
      kind: 'agent',
      appearance: { title: 'Visible card title' },
    };
    render(
      <Workshop
        embedded
        api={api({
          templates: vi.fn().mockResolvedValue([template]),
          template: vi.fn().mockResolvedValue({ ...template, config: {} }),
        })}
        choices={[]}
        projectId="s"
        onClose={vi.fn()}
        onInstalled={vi.fn()}
        beforeInstall={async () => {}}
      />
    );
    await screen.findByText('Visible card title');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search cards' }), {
      target: { value: 'Visible card' },
    });
    expect(
      screen.getByRole('button', { name: /Visible card title/ })
    ).toBeVisible();
  });

  it('previews the selected historical version that will be installed', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const old = {
        family: 'f',
        version: 1,
        name: 'Versioned card',
        kind: 'agent',
        appearance: { title: 'Original face' },
      },
      latest = { ...old, version: 2, appearance: { title: 'Latest face' } };
    render(
      <Workshop
        embedded
        api={api({
          templates: vi.fn().mockResolvedValue([latest, old]),
          template: vi.fn().mockImplementation(async (_f, version) => ({
            ...(version === 1 ? old : latest),
            config: {},
          })),
        })}
        choices={[]}
        projectId="s"
        onClose={vi.fn()}
        onInstalled={vi.fn()}
        beforeInstall={async () => {}}
      />
    );
    await screen.findByText('Latest face');
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Version' }), {
      key: 'Enter',
    });
    fireEvent.click(
      await screen.findByRole('option', { name: 'Versioned card · v1' })
    );
    await waitFor(() =>
      expect(screen.getByText('Original face')).toBeVisible()
    );
    expect(screen.queryByText('Latest face')).not.toBeInTheDocument();
  });

  it('associates design and capability tabs with their panels', async () => {
    render(
      <CardDesigner
        api={api({})}
        choices={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('tabpanel', { name: 'Appearance' })).getByRole(
          'textbox',
          { name: 'Card title' }
        )
      ).toBeVisible()
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Capabilities' }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('tabpanel', { name: 'Capabilities' })
        ).getByRole('textbox', { name: 'Role (optional)' })
      ).toBeVisible()
    );
  });

  it('retains a destination ID when Session creation commits but its response is lost', async () => {
    const template = {
      family: 'f',
      version: 1,
      name: 'Saved card',
      kind: 'agent',
      needs_model: false,
    };
    const createSession = vi
      .fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockImplementation(async (_name, id) => id);
    const installTemplate = vi.fn().mockResolvedValue(node),
      installed = vi.fn();
    render(
      <Workshop
        embedded
        api={api({
          templates: vi.fn().mockResolvedValue([template]),
          template: vi.fn().mockResolvedValue({ ...template, config: {} }),
        })}
        choices={[]}
        projectId="library"
        sessions={[]}
        createSession={createSession}
        resolveApi={() => api({ installTemplate })}
        onClose={vi.fn()}
        onInstalled={installed}
        beforeInstall={async () => {}}
      />
    );
    await screen.findByRole('button', { name: 'Saved card' });
    fireEvent.click(screen.getByRole('button', { name: 'Place on canvas' }));
    await screen.findByText(/Could not place/);
    fireEvent.click(screen.getByRole('button', { name: 'Place on canvas' }));
    await waitFor(() => expect(installed).toHaveBeenCalled());
    expect(createSession.mock.calls[0][1]).toEqual(expect.any(String));
    expect(createSession.mock.calls[0]).toEqual(createSession.mock.calls[1]);
    expect(installed).toHaveBeenCalledWith(
      node,
      createSession.mock.calls[0][1]
    );
  });

  it('keeps a pending editor mounted when Escape is pressed in Session modal mode', async () => {
    let finish!: (value: unknown) => void;
    const saveTemplate = vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      ),
      close = vi.fn();
    render(
      <Workshop
        api={api({ templates: vi.fn().mockResolvedValue([]), saveTemplate })}
        choices={[]}
        projectId="s"
        onClose={close}
        initialNode={node}
        onInstalled={vi.fn()}
        beforeInstall={async () => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    await waitFor(() => expect(saveTemplate).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    finish({ family: 'f', version: 1 });
    await screen.findByRole('button', { name: 'Design a card' });
  });

  it('offers a model for model-free custom cards through the legacy entry', async () => {
    const template = {
      family: 'f',
      version: 1,
      name: 'Draft card',
      kind: 'agent',
      needs_model: true,
    };
    const installTemplate = vi.fn().mockResolvedValue(node);
    render(
      <LegacyWorkshop
        api={api({
          templates: vi.fn().mockResolvedValue([template]),
          list: vi.fn().mockResolvedValue([]),
          batches: vi.fn().mockResolvedValue([]),
          installTemplate,
        })}
        choices={[
          {
            id: 'codex-subscription:test',
            name: 'Test model',
            group: 'codex-subscription',
            codexModelType: 'test',
          },
        ]}
        projectId="s"
        onClose={vi.fn()}
        onInstalled={vi.fn()}
        beforeInstall={async () => {}}
      />
    );
    await screen.findByRole('combobox', { name: 'Model' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Add to this session' })
    );
    await waitFor(() => expect(installTemplate).toHaveBeenCalled());
    expect(installTemplate.mock.calls[0][0].model).toMatchObject({
      model_type: 'test',
    });
  });

  it('saves a model-free design without creating a hidden Agent and preserves the retry gesture', async () => {
    const saveTemplate = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ family: 'f', version: 1 });
    const create = vi.fn(),
      onSaved = vi.fn();
    render(
      <CardDesigner
        api={api({ saveTemplate, create })}
        choices={[]}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Card title' }), {
      target: { value: 'My artwork title' },
    });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Capabilities' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Role (optional)' }), {
      target: { value: 'Independent researcher' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    await screen.findByText(/Could not save/);
    expect(
      screen.getByRole('textbox', { name: 'Role (optional)' })
    ).toHaveValue('Independent researcher');
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(saveTemplate.mock.calls[0][0]).toEqual(
      saveTemplate.mock.calls[1][0]
    );
    expect(saveTemplate.mock.calls[0][0]).toMatchObject({
      appearance: { title: 'My artwork title' },
      config: { model: null, role: 'Independent researcher' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('instance appearance saves call only the appearance API', async () => {
    const updateCard = vi.fn().mockResolvedValue(node),
      update = vi.fn(),
      saved = vi.fn();
    render(
      <InstanceCardDesigner
        api={api({ updateCard, update })}
        node={node}
        close={vi.fn()}
        onSaved={saved}
      />
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Card title' }), {
      target: { value: 'New face' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save appearance' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(node));
    expect(updateCard).toHaveBeenCalledWith(
      node,
      expect.objectContaining({ title: 'New face' })
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('placement retries preserve the instance ID and selected Session', async () => {
    const template = {
      family: 'f',
      version: 1,
      name: 'Saved card',
      kind: 'agent',
      needs_model: false,
    };
    const installTemplate = vi
      .fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValue(node);
    const resolveApi = vi.fn(() => api({ installTemplate })),
      installed = vi.fn();
    render(
      <Workshop
        embedded
        api={api({
          templates: vi.fn().mockResolvedValue([template]),
          template: vi.fn().mockResolvedValue({ ...template, config: {} }),
        })}
        choices={[]}
        projectId="s"
        sessions={[{ id: 's', name: 'Session' }]}
        resolveApi={resolveApi}
        onClose={vi.fn()}
        onInstalled={installed}
        beforeInstall={async () => {}}
      />
    );
    await screen.findByRole('button', { name: 'Saved card' });
    fireEvent.click(screen.getByRole('button', { name: 'Place on canvas' }));
    await screen.findByText(/Could not place/);
    fireEvent.click(screen.getByRole('button', { name: 'Place on canvas' }));
    await waitFor(() => expect(installed).toHaveBeenCalledWith(node, 's'));
    expect(installTemplate.mock.calls[0][0]).toEqual(
      installTemplate.mock.calls[1][0]
    );
    expect(resolveApi).toHaveBeenCalledWith('s');
  });

  it('rejects oversized and executable artwork before decoding', async () => {
    await expect(
      readCardArtwork(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }))
    ).rejects.toThrow();
    const large = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(large, 'size', { value: 9 * 1024 * 1024 });
    await expect(readCardArtwork(large)).rejects.toThrow();
  });
});
