// Cargo.toml:
//   clap = { version = "4", features = ["derive", "env"] }
//   clap_complete = "4"

use anyhow::Result;
use lib::add;
/// Boilder plate example
///
/// Use the shape, keep the completions, overhaul for correctness in the application
use std::io;
use std::path::PathBuf;

use clap::{ArgAction, CommandFactory, Parser, Subcommand, ValueEnum};
use clap_complete::Shell;

#[derive(Parser)]
#[command(version, about, arg_required_else_help = true)]
struct Cli {
    /// Example boolean flag shared by all subcommands
    #[arg(short = 'C', long = "git-dir", global = true)]
    git_dir: bool,

    /// Increase verbosity (-v, -vv, -vvv)
    #[arg(short, long, action = ArgAction::Count, global = true)]
    verbose: u8,

    /// API token, falls back to the environment when the flag is absent
    #[arg(long, env = "APP_TOKEN", hide_env_values = true, global = true)]
    token: Option<String>,

    /// Output format
    #[arg(long, value_enum, default_value_t = Format::Text, global = true)]
    format: Format,

    #[command(subcommand)]
    command: Command,
}

#[derive(Clone, Copy, ValueEnum)]
enum Format {
    Text,
    Json,
}

#[derive(Subcommand)]
enum Command {
    /// Deploy to a remote
    Add,
    /// Push to a remote
    Push {
        /// Directory to push
        dir: PathBuf,

        /// Suppress output
        #[arg(short, long)]
        quiet: bool,
    },
    /// Print shell completions to stdout
    #[command(hide = true)]
    Completions { shell: Shell },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let _ = (cli.git_dir, cli.verbose, cli.token, cli.format);
    match cli.command {
        Command::Add => {
            let a = 3;
            let b = 4;
            let result = add(a, b);
            let msg = duct::cmd!("echo", "`echo`", "from", "duct").read()?;
            println!("Duct:");
            println!("{msg}");
            println!("lib, add({a}, {b}): {result}");
        }
        Command::Push { dir: _, quiet: _ } => todo!(),
        Command::Completions { shell } => {
            clap_complete::generate(
                shell,
                &mut Cli::command(),
                env!("CARGO_BIN_NAME"),
                &mut io::stdout(),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn verify_cli() {
        use clap::CommandFactory;
        super::Cli::command().debug_assert();
    }
}
