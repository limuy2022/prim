use async_trait::async_trait;
use lib::{
    entity::{ReqwestMsg, ServerInfo, ServerStatus},
    net::{InnerStates, InnerStatesValue},
    Result, MESSAGE_NODE_ID_BEGINNING, MSGPROCESSOR_ID_BEGINNING, SCHEDULER_NODE_ID_BEGINNING,
};
use lib_net_tokio::net::{server::ReqwestCaller, ReqwestHandler};

use crate::{
    config::CONFIG,
    service::{ClientCallerMap, MessageNodeSet, MsgprocessorSet, SeqnumNodeSet},
    util::my_id,
};

pub(crate) struct ServerAuth {}

#[async_trait]
impl ReqwestHandler for ServerAuth {
    async fn run(&self, req: &mut ReqwestMsg, states: &mut InnerStates) -> Result<ReqwestMsg> {
        let client_map = states
            .get("generic_map")
            .unwrap()
            .as_generic_parameter_map()
            .unwrap()
            .get_parameter::<ClientCallerMap>()
            .unwrap();
        let message_node_set = states
            .get("generic_map")
            .unwrap()
            .as_generic_parameter_map()
            .unwrap()
            .get_parameter::<MessageNodeSet>()
            .unwrap();
        let seqnum_node_set = states
            .get("generic_map")
            .unwrap()
            .as_generic_parameter_map()
            .unwrap()
            .get_parameter::<SeqnumNodeSet>()
            .unwrap();
        let msgprocessor_set = states
            .get("generic_map")
            .unwrap()
            .as_generic_parameter_map()
            .unwrap()
            .get_parameter::<MsgprocessorSet>()
            .unwrap();
        let client_caller = states
            .get("generic_map")
            .unwrap()
            .as_generic_parameter_map()
            .unwrap()
            .get_parameter::<ReqwestCaller>();

        let server_info = ServerInfo::from(req.payload());
        if server_info.id >= MESSAGE_NODE_ID_BEGINNING
            && server_info.id < SCHEDULER_NODE_ID_BEGINNING
        {
            message_node_set.insert(server_info.id);
        } else if server_info.id >= SCHEDULER_NODE_ID_BEGINNING {
        } else if server_info.id < MSGPROCESSOR_ID_BEGINNING {
            seqnum_node_set.insert(server_info.id);
        } else {
            msgprocessor_set.insert(server_info.id);
        }
        if let Some(client_caller) = client_caller {
            client_map.insert(server_info.id, client_caller.clone());
        }
        states.insert(
            "node_id".to_owned(),
            InnerStatesValue::Num(server_info.id as u64),
        );

        let mut service_address = CONFIG.server.service_address;
        service_address.set_ip(CONFIG.server.service_ip.parse().unwrap());
        let mut cluster_address = CONFIG.server.cluster_address;
        cluster_address.set_ip(CONFIG.server.cluster_ip.parse().unwrap());
        let res_server_info = ServerInfo {
            id: my_id(),
            service_address,
            cluster_address: Some(cluster_address),
            connection_id: 0,
            status: ServerStatus::Normal,
            typ: server_info.typ,
            load: None,
        };
        let res_msg =
            ReqwestMsg::with_resource_id_payload(req.resource_id(), &res_server_info.to_bytes());
        Ok(res_msg)
    }
}
