//! Session rooms: everyone at a session joins `/rooms/{id}` and hears what the leader sends, such as
//! the next set. A skeleton for now: rooms are in memory and messages are relayed as they come.
//! Later this also fans out Live Activity broadcast pushes (APNs) and FCM topics, and runs the
//! "upload a session" setlist jobs.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::get;
use tokio::sync::broadcast;

/// Messages a slow listener may fall behind by before it misses some.
const ROOM_BACKLOG: usize = 64;

#[derive(Clone, Default)]
struct Rooms(Arc<Mutex<HashMap<String, broadcast::Sender<String>>>>);

impl Rooms {
    fn join(&self, id: &str) -> broadcast::Sender<String> {
        let mut rooms = self.0.lock().unwrap();
        rooms.retain(|_, room| room.receiver_count() > 0);
        rooms.entry(id.to_owned()).or_insert_with(|| broadcast::channel(ROOM_BACKLOG).0).clone()
    }
}

pub fn app() -> Router {
    Router::new().route("/health", get(|| async { "ok" })).route("/rooms/{id}", get(room)).with_state(Rooms::default())
}

async fn room(ws: WebSocketUpgrade, Path(id): Path<String>, State(rooms): State<Rooms>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| relay(socket, rooms.join(&id)))
}

/// Sends everything said in the room to this socket, and everything this socket says to the room.
async fn relay(mut socket: WebSocket, room: broadcast::Sender<String>) {
    let mut heard = room.subscribe();
    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(text))) => { let _ = room.send(text.to_string()); }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {}
            },
            outgoing = heard.recv() => match outgoing {
                Ok(text) => if socket.send(Message::Text(text.into())).await.is_err() { break },
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            },
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();
    let port = std::env::var("PORT").unwrap_or_else(|_| "4000".into());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await.expect("bind");
    tracing::info!("realtime listening on {port}");
    axum::serve(listener, app())
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
        })
        .await
        .expect("serve");
}
