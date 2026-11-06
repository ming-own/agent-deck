# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.session_agents import workshop
from app.session_agents.models import (
    AgentConfig,
    CardDesign,
    CreateTask,
    InstallTemplate,
    SaveTemplate,
    UpdateCardDesign,
)
from app.session_agents.store import AgentStore, Conflict, NotFound

MODEL = dict(
    id="provider:1", name="Local", model_platform="openai", model_type="test"
)


def draft(store, **changes):
    return workshop.save(
        store,
        ("owner", "source"),
        SaveTemplate(
            name="Sky card",
            config={"name": "Observer", "role": "researcher"},
            appearance=CardDesign(
                title="Sky", artwork="owl", material="silver"
            ),
            request_id=uuid4(),
            **changes,
        ),
    )


def place(store, template, **changes):
    request = InstallTemplate(
        family=template["family"],
        version=template["version"],
        instance_id=uuid4(),
        model=MODEL,
        **changes,
    )
    node = workshop.install(store, ("owner", "destination"), request)
    assert workshop.install(store, ("owner", "destination"), request) == node
    return store.get("owner", "destination", node)


def test_design_save_install_and_restart(tmp_path):
    store = AgentStore(tmp_path / "cards.db")
    saved = draft(store)
    assert not store.list(
        "owner", "source"
    )  # Designing never creates a hidden Agent.
    info = workshop.detail(store, "owner", saved["family"], 1)
    assert info["config"]["model"] is None
    assert info["appearance"]["title"] == "Sky"
    with pytest.raises(Conflict):
        workshop.install(
            store,
            ("owner", "destination"),
            InstallTemplate(
                family=saved["family"], version=1, instance_id=uuid4()
            ),
        )
    a, b = place(store, saved), place(store, saved)
    assert a["id"] != b["id"]
    assert a["card_design"]["material"] == "silver"
    assert a["role"] == "researcher"
    assert not store.runs("owner", "destination", a["id"])
    reloaded = AgentStore(tmp_path / "cards.db")
    assert (
        reloaded.get("owner", "destination", a["id"])["card_design"]
        == a["card_design"]
    )
    assert (
        workshop.catalog(reloaded, "owner")[-1]["appearance"]
        == info["appearance"]
    )


def test_appearance_and_capability_updates_are_independent(tmp_path):
    store = AgentStore(tmp_path / "cards.db")
    template = draft(store)
    a, b = place(store, template), place(store, template)
    scope = ("owner", "destination")
    store.set_link(*scope, a["id"], b["id"], True)
    task = store.create_task(
        *scope, a["id"], CreateTask(id=uuid4(), name="Keep me")
    )
    changed = workshop.update_card(
        store,
        scope,
        a["id"],
        UpdateCardDesign(
            expected_revision=a["card_revision"],
            design=CardDesign(title="Custom", material="ink"),
        ),
    )
    assert changed["revision"] == a["revision"]
    assert changed["card_revision"] == a["card_revision"] + 1
    behavior = AgentConfig(**{k: a[k] for k in AgentConfig.model_fields})
    behavior.role = "writer"
    updated = store.update(*scope, a["id"], a["revision"], behavior)
    assert updated["card_design"]["title"] == "Custom"
    assert updated["role"] == "writer"
    with pytest.raises(Conflict):
        workshop.update_card(
            store,
            scope,
            a["id"],
            UpdateCardDesign(
                expected_revision=a["card_revision"], design=CardDesign()
            ),
        )
    again = workshop.update_card(
        store,
        scope,
        a["id"],
        UpdateCardDesign(
            expected_revision=updated["card_revision"],
            design=CardDesign(layout="classic"),
        ),
    )
    assert (
        again["role"] == "writer" and again["revision"] == updated["revision"]
    )
    assert any(t["id"] == task["id"] for t in store.tasks(*scope, a["id"]))
    assert next(n for n in store.list(*scope) if n["id"] == a["id"])[
        "outputs"
    ] == [b["id"]]
    assert store.get(*scope, b["id"])["card_design"]["title"] == "Sky"
    assert (
        workshop.detail(store, "owner", template["family"], 1)["appearance"][
            "title"
        ]
        == "Sky"
    )


def test_versions_and_ownership(tmp_path):
    store = AgentStore(tmp_path / "cards.db")
    first = draft(store)
    request = SaveTemplate(
        name="Next",
        config={"name": "New", "role": "editor"},
        appearance=CardDesign(title="V2"),
        base_family=first["family"],
        base_version=1,
        new_version=True,
        request_id=uuid4(),
    )
    second = workshop.save(store, ("owner", "source"), request)
    assert workshop.save(store, ("owner", "source"), request) == second
    assert second["version"] == 2 and second["family"] == first["family"]
    assert (
        workshop.detail(store, "owner", first["family"], 1)["appearance"][
            "title"
        ]
        == "Sky"
    )
    with pytest.raises(Conflict):
        workshop.save(
            store,
            ("owner", "source"),
            request.model_copy(update={"request_id": uuid4()}),
        )
    with pytest.raises(NotFound):
        workshop.detail(store, "other", first["family"], 1)
    with pytest.raises(NotFound):
        workshop.save(store, ("other", "source"), request)
    node = place(store, second)
    with pytest.raises(NotFound):
        workshop.update_card(
            store,
            ("other", "destination"),
            node["id"],
            UpdateCardDesign(expected_revision=0, design=CardDesign()),
        )


def test_legacy_and_workforce_appearance(tmp_path):
    store = AgentStore(tmp_path / "cards.db")
    node = place(store, {"family": "builtin-team", "version": 1})
    scope = ("owner", "destination")
    updated = workshop.update_card(
        store,
        scope,
        node["id"],
        UpdateCardDesign(
            expected_revision=0,
            design=CardDesign(title="Team art", artwork="crab"),
        ),
    )
    saved = workshop.save(
        store, scope, SaveTemplate(name="Team card", node_id=node["id"])
    )
    clone = place(store, saved)
    assert clone["card_design"] == updated["card_design"]
    assert clone["workforce"] != node["workforce"]
    assert "card_design" not in AgentConfig.model_fields


def test_card_artwork_stays_out_of_execution_snapshot(tmp_path):
    store = AgentStore(tmp_path / "cards.db")
    node = place(store, draft(store))
    run, _ = store.begin(
        "owner", "destination", node["id"], node["revision"], "run", "hello"
    )
    assert "card_design" not in run["agent"]
    assert "card_revision" not in run["agent"]


def test_workforce_template_appearance_version_keeps_topology(tmp_path):
    store = AgentStore(tmp_path / "cards.db")
    first = workshop.save(
        store,
        ("o", "s"),
        SaveTemplate(
            name="Team",
            copy_base=True,
            base_family="builtin-team",
            base_version=1,
            appearance=CardDesign(artwork="crab"),
        ),
    )
    second = workshop.save(
        store,
        ("o", "s"),
        SaveTemplate(
            name="Team V2",
            copy_base=True,
            base_family=first["family"],
            base_version=1,
            new_version=True,
            appearance=CardDesign(material="ink"),
        ),
    )
    with store.connect() as db:
        import json

        rows = db.execute(
            "SELECT graph FROM workshop_versions WHERE owner='o' ORDER BY version"
        ).fetchall()
        a, b = [json.loads(r[0]) for r in rows]
    assert a["root"]["workforce"] == b["root"]["workforce"]
    assert second["version"] == 2


@pytest.mark.parametrize(
    "value",
    [
        "https://example.com/x.png",
        "data:image/svg+xml;base64,AAAA",
        "data:image/png;base64,bm90LWFuLWltYWdl",
    ],
)
def test_artwork_rejects_non_raster_or_remote_content(value):
    with pytest.raises(ValidationError):
        CardDesign(image_data=value)
