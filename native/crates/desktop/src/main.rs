use gpui_kit::*;

mod assets;
mod canvas;
mod cards;
mod inspector;
mod sidebar;
mod termination;
mod theme;

fn main() {
    application().with_assets(assets::Assets).run(|cx| {
        init(cx);
        theme::install(cx);
        cx.bind_keys([
            KeyBinding::new("cmd-q", canvas::Quit, None),
            KeyBinding::new("cmd-s", canvas::Save, None),
            KeyBinding::new("cmd-z", canvas::Undo, Some("Canvas")),
            KeyBinding::new("cmd-shift-z", canvas::Redo, Some("Canvas")),
            KeyBinding::new("escape", canvas::Cancel, Some("Canvas")),
            KeyBinding::new("backspace", canvas::Delete, Some("Canvas")),
            KeyBinding::new("f", canvas::Fit, Some("Canvas")),
        ]);
        cx.set_menus([
            Menu {
                name: "AgentDeck".into(),
                items: vec![MenuItem::action("退出 AgentDeck", canvas::Quit)],
                disabled: false,
            },
            Menu {
                name: "编辑".into(),
                items: vec![
                    MenuItem::action("撤销文字", component::input::Undo),
                    MenuItem::action("重做文字", component::input::Redo),
                    MenuItem::action("剪切", component::input::Cut),
                    MenuItem::action("复制", component::input::Copy),
                    MenuItem::action("粘贴", component::input::Paste),
                    MenuItem::action("全选", component::input::SelectAll),
                ],
                disabled: false,
            },
            Menu {
                name: "画布".into(),
                items: vec![
                    MenuItem::action("保存", canvas::Save),
                    MenuItem::action("撤销画布操作", canvas::Undo),
                    MenuItem::action("重做画布操作", canvas::Redo),
                    MenuItem::action("适应画布", canvas::Fit),
                ],
                disabled: false,
            },
        ]);
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        open_window(
            WindowOptions {
                titlebar: Some(TitlebarOptions {
                    title: Some("AgentDeck · 原生画布预览".into()),
                    ..Default::default()
                }),
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(1360.0), px(860.0)),
                    cx,
                ))),
                window_min_size: Some(size(px(960.0), px(620.0))),
                ..Default::default()
            },
            cx,
            |window, cx| cx.new(|cx| canvas::Desktop::new(window, cx)),
        )
        .expect("Open AgentDeck window");
        cx.activate(true);
    });
}
