mod client;
mod handler;
mod server;

use std::{sync::Arc, str::FromStr};

use dashmap::DashMap;
use lazy_static::lazy_static;
use lib::{
    entity::{Msg, ServerInfo},
    net::{OuterSender, server::GenericParameter},
    Result,
};

use crate::util::should_connect_to_peer;

use self::client::Client;

pub(crate) struct ClusterConnectionMap(pub(crate) Arc<DashMap<u32, OuterSender>>);

lazy_static! {
    static ref CLUSTER_CONNECTION_MAP: ClusterConnectionMap =
        ClusterConnectionMap(Arc::new(DashMap::new()));
    static ref CLUSTER_CLIENT: Client = Client::new();
}

impl GenericParameter for ClusterConnectionMap {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn as_mut_any(&mut self) -> &mut dyn std::any::Any {
        self
    }
}

pub(crate) fn get_cluster_connection_map() -> ClusterConnectionMap {
    ClusterConnectionMap(CLUSTER_CONNECTION_MAP.0.clone())
}

pub(crate) async fn node_online(msg: Arc<Msg>) -> Result<()> {
    let server_info = ServerInfo::from(msg.payload());
    let new_peer = bool::from_str(&String::from_utf8_lossy(msg.extension()))?;
    if should_connect_to_peer(server_info.id, new_peer) {
        CLUSTER_CLIENT.new_connection(server_info.cluster_address.unwrap()).await?;
    }
    Ok(())
}

pub(crate) async fn node_offline(msg: Arc<Msg>) -> Result<()> {
    let server_info = ServerInfo::from(msg.payload());
    CLUSTER_CONNECTION_MAP
        .0
        .remove(&server_info.id);
    Ok(())
}

#[allow(unused)]
pub(crate) async fn node_crash(msg: Arc<Msg>) -> Result<()> {
    todo!("node_crash");
}

#[allow(unused)]
pub(crate) async fn start() -> Result<()> {
    server::Server::run().await?;
    Ok(())
}
