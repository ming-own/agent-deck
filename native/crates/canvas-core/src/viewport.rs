use crate::GraphError;
use serde::{Deserialize, Deserializer, Serialize};

// Keep persisted geometry within a useful f32 precision range and well away
// from overflow during zoom, projection, and hit testing.
const MAX_COORDINATE: f32 = 1_000_000.0;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

impl Point {
    pub(crate) fn is_valid(self) -> bool {
        self.x.abs() <= MAX_COORDINATE && self.y.abs() <= MAX_COORDINATE
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Viewport {
    offset: Point,
    zoom: f32,
}

impl Default for Viewport {
    fn default() -> Self {
        Self {
            offset: Point::default(),
            zoom: 1.0,
        }
    }
}

impl Viewport {
    pub fn new(offset: Point, zoom: f32) -> Result<Self, GraphError> {
        if !offset.is_valid() || !(0.15..=3.0).contains(&zoom) {
            return Err(GraphError::InvalidGeometry);
        }
        Ok(Self { offset, zoom })
    }

    pub fn zoom(self) -> f32 {
        self.zoom
    }
    pub fn offset(self) -> Point {
        self.offset
    }

    pub fn screen_to_world(self, point: Point) -> Point {
        Point {
            x: (point.x - self.offset.x) / self.zoom,
            y: (point.y - self.offset.y) / self.zoom,
        }
    }

    pub fn world_to_screen(self, point: Point) -> Point {
        Point {
            x: point.x * self.zoom + self.offset.x,
            y: point.y * self.zoom + self.offset.y,
        }
    }

    pub fn zoom_at(&mut self, pointer: Point, zoom: f32) -> Result<(), GraphError> {
        if !pointer.is_valid() || !zoom.is_finite() || zoom <= 0.0 {
            return Err(GraphError::InvalidGeometry);
        }
        let world = self.screen_to_world(pointer);
        let zoom = zoom.clamp(0.15, 3.0);
        *self = Self::new(
            Point {
                x: pointer.x - world.x * zoom,
                y: pointer.y - world.y * zoom,
            },
            zoom,
        )?;
        Ok(())
    }
}

impl<'de> Deserialize<'de> for Viewport {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct StoredViewport {
            offset: Point,
            zoom: f32,
        }
        let stored = StoredViewport::deserialize(deserializer)?;
        Self::new(stored.offset, stored.zoom).map_err(serde::de::Error::custom)
    }
}
