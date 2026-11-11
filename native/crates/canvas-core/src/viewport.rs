use crate::GraphError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

impl Point {
    pub(crate) fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
        if !offset.is_finite() || !(0.15..=3.0).contains(&zoom) {
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
        if !pointer.is_finite() || !zoom.is_finite() || zoom <= 0.0 {
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
