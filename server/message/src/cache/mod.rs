use tokio::sync::OnceCell;
use common::cache::redis_ops::RedisOps;
use crate::CONFIG;

/// use singleton instance by it's all clones to share connection between Tasks.
pub(crate) static REDIS_OPS: OnceCell<RedisOps> = OnceCell::const_new();

pub(super) async fn get_redis_ops() -> RedisOps {
    (REDIS_OPS
        .get_or_init(|| async { RedisOps::connect(CONFIG.redis.addresses.clone()).await.unwrap() })
        .await)
        .clone()
}

pub(crate) static TOKEN_KEY: &str = "token_key_";
pub(crate) static NODE_ID_KEY: &str = "node_id";
