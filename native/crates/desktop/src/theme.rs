use agentdeck_canvas_core::NodeKind;
use gpui_kit::App;
use gpui_kit::Hsla;
use gpui_kit::component::{Theme, ThemeConfig};
use serde::Deserialize;
use std::rc::Rc;
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Clone, Copy, Deserialize)]
pub struct Material {
    pub edge: Hsla,
    pub paper: Hsla,
    pub ink: Hsla,
}

pub fn material(kind: NodeKind) -> Material {
    static MATERIALS: OnceLock<BTreeMap<String, Material>> = OnceLock::new();
    // Reuse the approved collectible-card exception; these are print materials,
    // independent of the application's light/dark surface colors.
    let values = MATERIALS.get_or_init(|| {
        let mut values: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../src/style/tokens/card.material.json"
        ))
        .unwrap();
        values
            .as_object_mut()
            .unwrap()
            .retain(|key, _| matches!(key.as_str(), "gold" | "jade" | "violet"));
        serde_json::from_value(values).unwrap()
    });
    values[match kind {
        NodeKind::Agent => "gold",
        NodeKind::Context | NodeKind::Memory => "jade",
        NodeKind::Automation => "violet",
    }]
}

#[derive(Deserialize)]
struct Palettes {
    light: ThemeConfig,
    dark: ThemeConfig,
}

pub fn install(cx: &mut App) {
    // These roles come from AgentDeck's existing theme-token engine. Keep
    // native controls on the same palette as the application-owned surfaces.
    let palettes: Palettes = serde_json::from_str(include_str!("../assets/palette.json"))
        .expect("embedded AgentDeck theme must be valid");
    Theme::update(cx, |theme| {
        theme.light_theme = Rc::new(palettes.light);
        theme.dark_theme = Rc::new(palettes.dark);
        let selected = if theme.is_dark() {
            theme.dark_theme.clone()
        } else {
            theme.light_theme.clone()
        };
        theme.apply_config(&selected);
    });
}
