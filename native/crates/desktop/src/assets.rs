use gpui_kit::{AssetSource, Result, SharedString};
use std::borrow::Cow;

pub struct Assets;
impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        let art: Option<&'static [u8]> = match path {
            "cards/guardian.webp" => Some(include_bytes!(
                "../../../../src/assets/cards/guardian-sapphire.webp"
            )),
            "cards/archive.webp" => Some(include_bytes!(
                "../../../../src/assets/cards/archive-jade.webp"
            )),
            "cards/dragon.webp" => Some(include_bytes!(
                "../../../../src/assets/cards/dragon-amethyst.webp"
            )),
            _ => None,
        };
        match art {
            Some(bytes) => Ok(Some(Cow::Borrowed(bytes))),
            None => gpui_kit::assets::Assets.load(path),
        }
    }
    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        gpui_kit::assets::Assets.list(path)
    }
}
