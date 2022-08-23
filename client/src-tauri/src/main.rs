#![cfg_attr(
all(not(debug_assertions), target_os = "windows"),
windows_subsystem = "windows"
)]

use std::fmt::Debug;
use std::str::FromStr;
use byteorder::ByteOrder;
use tauri::Manager;
use serde::{Serialize, Deserialize};
use tokio::runtime::Handle;
use tracing::{debug, info, warn, error};
use tracing::field::debug;
use crate::entity::msg;

mod entity;
mod core;
mod util;
mod error;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_max_level(tracing::Level::DEBUG)
        .try_init().unwrap();
    let handle = tokio::runtime::Handle::current();
    tauri::Builder::default()
        .setup(move |app| {
            let window = app.get_window("main").unwrap();
            setup(window);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Cmd {
    name: String,
    args: Vec<Vec<u8>>,
}

impl Cmd {
    fn connect_result(result: bool) -> Self {
        let mut args = Vec::with_capacity(1);
        args.push(Vec::from(true.to_string()));
        Self {
            name: String::from("connect-result"),
            args,
        }
    }

    fn recv_msg(msg: &msg::Msg) -> Self {
        let mut args = Vec::with_capacity(1);
        args.push(msg.as_bytes());
        Self {
            name: String::from("recv-msg"),
            args,
        }
    }

    fn text_str(text: &'static str) -> Self {
        let mut args = Vec::with_capacity(1);
        args.push(Vec::from(text));
        Self {
            name: String::from("text-str"),
            args,
        }
    }

    fn from_payload(payload: &str) -> Self {
        let cmd: Result<Cmd, serde_json::Error> = serde_json::from_str(payload);
        if let Err(_) = cmd {
            return Self {
                name: String::from(""),
                args: Vec::new(),
            }
        } else {
            cmd.unwrap()
        }
    }
}

fn setup(window1: tauri::window::Window<tauri::Wry>) {
    let window2 = window1.clone();
    window1.listen("test", move |event| {
        if let Ok(rt) = Handle::try_current() {
            println!("{:?}", rt);
        }
    });
    window1.listen("connect", move |event| {
        let address = event.payload();
        if let None = address {
            window2.emit("cmd-res", Cmd::connect_result(false));
            error!("need address provided");
            return;
        }
        let address = address.unwrap().to_string();
        let window3 = window2.clone();
        tauri::async_runtime::spawn(async move {
            let client = core::client::Client::connect(address).await;
            if let Err(_) = client {
                error!("can't connect to server");
                window3.emit("cmd-res", Cmd::connect_result(false));
                return;
            }
            let mut client = client.unwrap();
            client.run();
            debug!("runing");
            let data_in = client.data_in();
            let mut data_out = client.data_out();
            window3.emit("cmd-res", Cmd::connect_result(true));
            let window4 = window3.clone();
            let client = std::sync::Arc::new(tokio::sync::Mutex::new(client));
            window3.listen("cmd", move |event| {
                let payload = event.payload();
                if let None = payload {
                    return;
                }
                let payload = payload.unwrap();
                let cmd = Cmd::from_payload(payload);
                debug!("{:?}", cmd);
                if cmd.name.is_empty() {
                    window4.emit("cmd-res", Cmd::text_str("parse failed"));
                    return;
                }
                match cmd.name.as_str() {
                    "heartbeat" => {
                        let sender_id = byteorder::BigEndian::read_u64(cmd.args[0].as_slice());
                        debug!("{}", sender_id);
                        let client = client.clone();
                        tauri::async_runtime::spawn(async move {
                            let lock = client.lock().await;
                            (*lock).heartbeat(sender_id);
                        });
                    },
                    "close" => {
                        let client = client.clone();
                        tauri::async_runtime::spawn(async move {
                            let lock = client.lock().await;
                            (*lock).close().await;
                        });
                    },
                    "send-msg" => {
                        let data_in = data_in.clone();
                        let msg = msg::Msg::from(&cmd.args[0]);
                        tauri::async_runtime::spawn(async move {
                            let _ = data_in.send(msg).await;
                        });
                    },
                    _ => {}
                };
            });
            tauri::async_runtime::spawn(async move {
                let mut data_out = &mut data_out;
                loop {
                    let msg = data_out.recv().await;
                    if let None = msg {
                        return;
                    }
                    let msg = msg.unwrap();
                    window3.emit("cmd-res", Cmd::recv_msg(&msg));
                }
            });
        });
    });
}