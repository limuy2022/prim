use std::{sync::Arc, time::Duration};

use anyhow::anyhow;
use async_trait::async_trait;
use lib::{
    entity::{ReqwestMsg, ReqwestResourceID, ServerInfo, ServerType},
    net::{
        client::{ClientConfig, ClientReqwest},
        InnerStates, NewReqwestConnectionHandler, ReqwestHandlerGenerator, ReqwestHandlerMap,
        ReqwestOperatorManager,
    },
    Result,
};
use tokio::sync::mpsc;
use tracing::error;

pub async fn connect2scheduler(
    client_config: ClientConfig,
    client_id: u32,
    timeout: Duration,
    handler_map: ReqwestHandlerMap,
    self_info: ServerInfo,
    states_gen: Box<dyn Fn() -> InnerStates + Send + Sync + 'static>,
) -> Result<ReqwestOperatorManager> {
    let mut client = ClientReqwest::new(client_config, timeout, client_id);

    struct ReqwestMessageHandler {
        handler_map: ReqwestHandlerMap,
        states: InnerStates,
    }

    #[async_trait]
    impl NewReqwestConnectionHandler for ReqwestMessageHandler {
        async fn handle(
            &mut self,
            msg_operators: (mpsc::Sender<ReqwestMsg>, mpsc::Receiver<ReqwestMsg>),
        ) -> Result<()> {
            let (send, mut recv) = msg_operators;
            loop {
                match recv.recv().await {
                    Some(mut req) => {
                        let resource_id = req.resource_id();
                        let req_id = req.req_id();
                        let handler = self.handler_map.get(&resource_id);
                        if handler.is_none() {
                            error!("no handler for resource_id: {}", resource_id);
                            continue;
                        }
                        let handler = handler.unwrap();
                        let resp = handler.run(&mut req, &mut self.states).await;
                        if resp.is_err() {
                            error!("handler run error: {}", resp.err().unwrap());
                            continue;
                        }
                        let mut resp = resp.unwrap();
                        resp.set_req_id(req_id);
                        _ = send.send(resp).await;
                    }
                    None => {
                        break;
                    }
                }
            }
            Ok(())
        }
    }
    let generator: ReqwestHandlerGenerator =
        Box::new(move || -> Box<dyn NewReqwestConnectionHandler> {
            let states = states_gen();
            Box::new(ReqwestMessageHandler {
                handler_map: handler_map.clone(),
                states,
            })
        });
    let generator = Arc::new(generator);
    let operator = client.build(generator).await?;

    let mut auth_info = self_info.clone();
    auth_info.typ = ServerType::SchedulerClient;
    let auth_msg = ReqwestMsg::with_resource_id_payload(
        ReqwestResourceID::NodeAuth.value(),
        &auth_info.to_bytes(),
    );
    let resp = operator.call(auth_msg).await?;
    if resp.payload() != b"true" {
        return Err(anyhow!("auth failed"));
    }
    let register_msg = ReqwestMsg::with_resource_id_payload(
        ReqwestResourceID::SeqnumNodeRegister.value(),
        &self_info.to_bytes(),
    );
    let resp = operator.call(register_msg).await?;
    if resp.payload() != b"true" {
        return Err(anyhow!("register failed"));
    }
    Ok(operator)
}
