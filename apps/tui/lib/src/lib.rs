#![deny(clippy::all)]

use napi_derive::napi;

const DEFAULT_ITEMS: [&str; 6] = [
  "Edit apps/tui/lib/src/lib.rs to change the data",
  "Add a command in apps/tui/lib/src/lib.rs",
  "Render it in apps/tui/app/src/ui/Main.tsx",
  "Pure helpers go in apps/tui/lib/src/",
  "Run `pnpm test` for native and render tests",
  "Run `pnpm build` to build the applications",
];

#[derive(Clone, Copy)]
enum Command {
  Move(i64),
  Page(i64),
  Top,
  Bottom,
  Choose,
  Theme,
  Quit,
}

struct Binding {
  keys: &'static [&'static str],
  help: Option<(&'static str, &'static str)>,
  command: Command,
}

// Dispatch and displayed help come from this single command table.
const BINDINGS: &[Binding] = &[
  Binding {
    keys: &["j", "down"],
    help: Some(("j/k", "move")),
    command: Command::Move(1),
  },
  Binding {
    keys: &["k", "up"],
    help: None,
    command: Command::Move(-1),
  },
  Binding {
    keys: &["g"],
    help: Some(("g/G", "top/bottom")),
    command: Command::Top,
  },
  Binding {
    keys: &["G"],
    help: None,
    command: Command::Bottom,
  },
  Binding {
    keys: &["pagedown"],
    help: None,
    command: Command::Page(1),
  },
  Binding {
    keys: &["pageup"],
    help: None,
    command: Command::Page(-1),
  },
  Binding {
    keys: &["return", "l"],
    help: Some(("enter", "choose")),
    command: Command::Choose,
  },
  Binding {
    keys: &["t"],
    help: Some(("t", "theme")),
    command: Command::Theme,
  },
  Binding {
    keys: &["q"],
    help: Some(("q", "quit")),
    command: Command::Quit,
  },
];

#[napi(object)]
pub struct KeyHelp {
  pub icon: String,
  pub label: String,
}

#[napi]
pub fn default_items() -> Vec<String> {
  DEFAULT_ITEMS
    .iter()
    .map(|item| (*item).to_owned())
    .collect()
}

#[napi]
pub fn key_help() -> Vec<KeyHelp> {
  BINDINGS
    .iter()
    .filter_map(|binding| {
      binding.help.map(|(icon, label)| KeyHelp {
        icon: icon.to_owned(),
        label: label.to_owned(),
      })
    })
    .collect()
}

#[napi]
pub struct ListState {
  entries: Vec<String>,
  cursor: usize,
  // Entries are immutable, so an index preserves the choice without copying it.
  chosen_index: Option<usize>,
}

#[napi]
impl ListState {
  #[napi(constructor)]
  pub fn new(entries: Vec<String>) -> Self {
    Self {
      entries,
      cursor: 0,
      chosen_index: None,
    }
  }

  #[napi(getter)]
  pub fn entries(&self) -> Vec<String> {
    self.entries.clone()
  }

  #[napi(getter)]
  pub fn cursor(&self) -> i64 {
    self.cursor as i64
  }

  #[napi(getter)]
  pub fn selected(&self) -> Option<String> {
    self.entries.get(self.cursor).cloned()
  }

  #[napi(getter)]
  pub fn chosen(&self) -> Option<String> {
    self
      .chosen_index
      .and_then(|index| self.entries.get(index))
      .cloned()
  }

  #[napi]
  pub fn move_to(&mut self, index: i64) {
    self.cursor = index.clamp(0, self.entries.len().saturating_sub(1) as i64) as usize;
  }

  #[napi(js_name = "move")]
  pub fn move_by(&mut self, delta: i64) {
    self.move_to((self.cursor as i64).saturating_add(delta));
  }

  #[napi]
  pub fn top(&mut self) {
    self.cursor = 0;
  }

  #[napi]
  pub fn bottom(&mut self) {
    self.cursor = self.entries.len().saturating_sub(1);
  }

  #[napi]
  pub fn choose(&mut self) {
    self.chosen_index = if self.entries.is_empty() {
      None
    } else {
      Some(self.cursor)
    };
  }

  #[napi]
  pub fn handle_key(
    &mut self,
    name: String,
    sequence: String,
    shift: bool,
    page_size: i64,
  ) -> &'static str {
    // Terminals report uppercase G as a sequence, a name, or shifted lowercase g.
    let name = if sequence == "G" || (name == "g" && shift) {
      "G"
    } else {
      name.as_str()
    };
    let Some(binding) = BINDINGS.iter().find(|binding| binding.keys.contains(&name)) else {
      return "unhandled";
    };

    match binding.command {
      Command::Move(delta) => self.move_by(delta),
      Command::Page(direction) => self.move_by(page_size.saturating_mul(direction)),
      Command::Top => self.top(),
      Command::Bottom => self.bottom(),
      Command::Choose => self.choose(),
      Command::Theme => return "theme",
      Command::Quit => return "quit",
    }
    "handled"
  }
}

#[napi]
pub fn scroll_offset(cursor: i32, height: i32, length: i32) -> i32 {
  cursor
    .saturating_sub(height.div_euclid(2))
    .min(length.saturating_sub(height))
    .max(0)
}

#[cfg(test)]
mod tests {
  use super::scroll_offset;

  #[test]
  fn centers_the_cursor_and_clamps_at_either_end() {
    assert_eq!(scroll_offset(0, 10, 30), 0);
    assert_eq!(scroll_offset(15, 10, 30), 10);
    assert_eq!(scroll_offset(29, 10, 30), 20);
  }

  #[test]
  fn handles_short_empty_unselected_and_single_row_lists() {
    assert_eq!(scroll_offset(2, 10, 3), 0);
    assert_eq!(scroll_offset(0, 1, 0), 0);
    assert_eq!(scroll_offset(-1, 10, 30), 0);
    assert_eq!(scroll_offset(3, 1, 10), 3);
  }
}
