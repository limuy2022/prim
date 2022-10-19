use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;
use lazy_static::lazy_static;

use anyhow::Context;
use quinn::VarInt;
use structopt::lazy_static::lazy_static;
use tracing::Level;

#[derive(serde_derive::Deserialize, Debug)]
struct Config0 {
    log_level: Option<String>,
    sql: Option<Sql0>,
}

#[derive(Debug)]
pub(crate) struct Config {
    pub(crate) log_level: Level,
    pub(crate) sql: Sql,
}

#[derive(serde_derive::Deserialize, Debug)]
struct Sql0 {
    address: Option<String>,
    database: Option<String>,
    schema: Option<String>,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Debug)]
pub(crate) struct Sql {
    pub(crate) address: String,
    pub(crate) database: String,
    pub(crate) schema: String,
    pub(crate) username: String,
    pub(crate) password: String,
}

pub(crate) fn load_config() -> Config {
    let toml_str = fs::read_to_string("config.toml").unwrap();
    let config0: Config0 = toml::from_str(&toml_str).unwrap();
    Config::from_config0(config0)
}

lazy_static!(
    pub(crate) static ref CONFIG: Config = load_config();
);