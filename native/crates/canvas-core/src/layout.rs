use crate::{Graph, GraphError, Viewport};
use serde::{Deserialize, Serialize};

const MAX_LAYOUT_BYTES: usize = 16 * 1024 * 1024;

/// An isolated canvas document. It contains no messages, credentials or grants.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Layout {
    version: u32,
    pub graph: Graph,
    pub viewport: Viewport,
}

impl Layout {
    pub fn new(graph: Graph, viewport: Viewport) -> Self {
        Self {
            version: 1,
            graph,
            viewport,
        }
    }

    pub fn to_json(&self) -> Result<String, GraphError> {
        let json = serde_json::to_string_pretty(self).map_err(|_| GraphError::InvalidLayout)?;
        if json.len() > MAX_LAYOUT_BYTES {
            return Err(GraphError::InvalidLayout);
        }
        Ok(json)
    }

    pub fn from_json(json: &str) -> Result<Self, GraphError> {
        if json.len() > MAX_LAYOUT_BYTES {
            return Err(GraphError::InvalidLayout);
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct StoredLayout {
            version: u32,
            graph: Graph,
            viewport: Viewport,
        }
        let stored: StoredLayout =
            serde_json::from_str(json).map_err(|_| GraphError::InvalidLayout)?;
        if stored.version != 1 {
            return Err(GraphError::InvalidLayout);
        }
        Ok(Self::new(stored.graph, stored.viewport))
    }
}
