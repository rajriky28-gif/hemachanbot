const { Redis } = require('@upstash/redis');

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// In-memory fallback for local development/testing without environment variables
const memoryDb = {};

let redis = null;

if (url && token) {
  try {
    redis = new Redis({ url, token });
    console.log("Redis client initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize Redis client:", error);
  }
} else {
  console.log("Redis credentials not found. Using in-memory fallback (only suitable for single-instance local testing).");
}

/**
 * Adds a photo file_id to the user's current list of images.
 * @param {string|number} userId - The Telegram user ID.
 * @param {string} fileId - The Telegram photo file_id.
 */
async function addImage(userId, fileId) {
  const key = `collage_bot:${userId}`;
  if (redis) {
    await redis.rpush(key, fileId);
  } else {
    if (!memoryDb[key]) {
      memoryDb[key] = [];
    }
    memoryDb[key].push(fileId);
  }
}

/**
 * Retrieves the current list of photo file_ids for a user.
 * @param {string|number} userId - The Telegram user ID.
 * @returns {Promise<string[]>} List of file_ids.
 */
async function getImages(userId) {
  const key = `collage_bot:${userId}`;
  if (redis) {
    return await redis.lrange(key, 0, -1);
  } else {
    return memoryDb[key] || [];
  }
}

/**
 * Clears the stored photo list for a user.
 * @param {string|number} userId - The Telegram user ID.
 */
async function clearImages(userId) {
  const key = `collage_bot:${userId}`;
  if (redis) {
    await redis.del(key);
  } else {
    delete memoryDb[key];
  }
}

/**
 * Saves the message ID of the last sent keyboard control panel.
 */
async function setLastMessageId(userId, messageId) {
  const key = `collage_bot_msg:${userId}`;
  if (redis) {
    await redis.set(key, messageId);
  } else {
    memoryDb[key] = messageId;
  }
}

/**
 * Retrieves the message ID of the last sent keyboard control panel.
 */
async function getLastMessageId(userId) {
  const key = `collage_bot_msg:${userId}`;
  if (redis) {
    const val = await redis.get(key);
    return val ? parseInt(val, 10) : null;
  } else {
    return memoryDb[key] ? parseInt(memoryDb[key], 10) : null;
  }
}

/**
 * Deletes the saved message ID.
 */
async function clearLastMessageId(userId) {
  const key = `collage_bot_msg:${userId}`;
  if (redis) {
    await redis.del(key);
  } else {
    delete memoryDb[key];
  }
}

module.exports = {
  addImage,
  getImages,
  clearImages,
  setLastMessageId,
  getLastMessageId,
  clearLastMessageId,
};
