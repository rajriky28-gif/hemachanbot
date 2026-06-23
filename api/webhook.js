require('dotenv').config();
const { Bot, webhookCallback, InlineKeyboard, InputFile } = require('grammy');
const db = require('../lib/db');
const { createCollage } = require('../lib/collage');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.warn("WARNING: TELEGRAM_BOT_TOKEN environment variable is not defined!");
}

const bot = new Bot(token || 'dummy_token_for_compilation');

// Handle start and help commands
bot.command(['start', 'help'], async (ctx) => {
  await ctx.reply(
    `📸 *Collage Maker Bot* 📸\n\n` +
    `Send me **2 or more images** as photos. I will combine them into a beautiful collage!\n\n` +
    `*How to use:*\n` +
    `1. Send images to me one by one. I'll add them to your queue.\n` +
    `2. Click **Horizontal Collage** or **Vertical Collage** to merge them.\n` +
    `3. Click **Clear & Restart** if you want to clear your current queue and start fresh.\n\n` +
    `_Ready when you are! Send me your first photo._`,
    { parse_mode: 'Markdown' }
  );
});

// Handle incoming photos
bot.on('message:photo', async (ctx) => {
  try {
    const userId = ctx.from.id;

    // Check if the user already has too many images
    const existingImages = await db.getImages(userId);
    if (existingImages.length >= 8) {
      const keyboard = new InlineKeyboard()
        .text("⬅️ Horizontal Collage", "collage_horizontal")
        .text("⬇️ Vertical Collage", "collage_vertical")
        .row()
        .text("❌ Clear & Restart", "collage_clear");

      const lastMsgId = await db.getLastMessageId(userId);
      if (lastMsgId) {
        await ctx.api.deleteMessage(ctx.chat.id, lastMsgId).catch(() => {});
      }

      const sentMsg = await ctx.reply(
        `⚠️ *Queue Limit Reached (Max: 8 photos)*\n\n` +
        `You already have 8 photos in your queue. Please generate your collage now, or click **Clear & Restart** to start fresh.`,
        {
          reply_markup: keyboard,
          parse_mode: 'Markdown'
        }
      );

      await db.setLastMessageId(userId, sentMsg.message_id);
      return;
    }

    // Telegram sends photos in an array of different sizes.
    // The last element is the highest resolution version.
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;

    // Save to database
    await db.addImage(userId, fileId);

    // Retrieve updated list to count
    const images = await db.getImages(userId);
    const count = images.length;

    // Inline buttons for controls
    const keyboard = new InlineKeyboard()
      .text("⬅️ Horizontal Collage", "collage_horizontal")
      .text("⬇️ Vertical Collage", "collage_vertical")
      .row()
      .text("❌ Clear & Restart", "collage_clear");

    // Delete the previous menu message to keep the chat clean and avoid repeats
    const lastMsgId = await db.getLastMessageId(userId);
    if (lastMsgId) {
      await ctx.api.deleteMessage(ctx.chat.id, lastMsgId).catch(() => {});
    }

    const sentMsg = await ctx.reply(
      `✅ Photo added! (Current Queue: *${count}* ${count === 1 ? 'photo' : 'photos'})\n\n` +
      `Send more photos, or choose a layout below to generate your collage:`,
      {
        reply_markup: keyboard,
        parse_mode: 'Markdown'
      }
    );

    // Save the new menu message ID
    await db.setLastMessageId(userId, sentMsg.message_id);
  } catch (error) {
    console.error("Error receiving photo:", error);
    await ctx.reply("❌ Sorry, something went wrong while saving your photo. Please try again.");
  }
});

// Handle clear button
bot.callbackQuery('collage_clear', async (ctx) => {
  const userId = ctx.from.id;
  try {
    await db.clearImages(userId);
    await db.clearLastMessageId(userId);
    await ctx.answerCallbackQuery({ text: "Queue cleared!" });
    await ctx.editMessageText(
      "❌ Your collage queue has been cleared! Send some new photos to start fresh."
    );
  } catch (error) {
    console.error("Error clearing queue:", error);
    await ctx.answerCallbackQuery({ text: "Error clearing queue" });
    await ctx.reply("❌ Error resetting your queue.");
  }
});

// Handle layout generation
bot.callbackQuery(['collage_horizontal', 'collage_vertical'], async (ctx) => {
  const userId = ctx.from.id;
  const action = ctx.callbackQuery.data;
  const direction = action === 'collage_horizontal' ? 'horizontal' : 'vertical';

  try {
    const fileIds = await db.getImages(userId);
    if (!fileIds || fileIds.length < 2) {
      await ctx.answerCallbackQuery({
        text: "Please send at least 2 photos first!",
        show_alert: true
      });
      return;
    }

    // Acknowledge callback immediately to stop the loading spinner
    await ctx.answerCallbackQuery({ text: "Stitching photos..." });

    // Send status indicator
    const statusMessage = await ctx.reply("⏳ Downloading and stitching your photos together... please wait.");

    // Retrieve file paths/URLs from Telegram
    const imageUrls = await Promise.all(
      fileIds.map(async (fileId) => {
        const file = await ctx.api.getFile(fileId);
        return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      })
    );

    // Create collage buffer using Jimp
    const collageBuffer = await createCollage(imageUrls, direction);

    // 1. Send as Photo (for quick inline chat preview)
    await ctx.replyWithPhoto(new InputFile(collageBuffer, `collage_${direction}.jpg`), {
      caption: `🎉 Quick preview of your ${direction} collage (${fileIds.length} photos):`,
    });

    // 2. Send as Document (forces Telegram to send it uncompressed, keeping text extremely sharp!)
    await ctx.replyWithDocument(new InputFile(collageBuffer, `collage_${direction}_highres.jpg`), {
      caption: `💾 here is the Full HD (uncompressed) file for reading fine details and small text!`,
    });

    // Delete status message
    await ctx.api.deleteMessage(ctx.chat.id, statusMessage.message_id).catch(() => {});

    // Reset user queue and clear menu tracking
    await db.clearImages(userId);
    await db.clearLastMessageId(userId);

  } catch (error) {
    console.error("Error generating collage:", error);
    
    // Clear user queue so they don't get stuck in a broken loop
    await db.clearImages(userId).catch(() => {});
    await db.clearLastMessageId(userId).catch(() => {});

    await ctx.reply(
      "❌ *Error generating your collage.*\n\n" +
      "Make sure all uploaded photos are fresh and try again with fewer images (we have reset your queue to prevent further errors).",
      { parse_mode: 'Markdown' }
    );
  }
});

// Generic fallbacks for text / other message types
bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return; // let commands handle themselves
  await ctx.reply("⚠️ I'm a collage helper. Please send me photos directly so I can compile them!");
});

bot.on('message', async (ctx) => {
  await ctx.reply("⚠️ Please send images as photos (compressed files) so I can add them to the collage.");
});

// Export webhook callback compatible with Vercel serverless environment
const handleWebhook = webhookCallback(bot, 'http');

module.exports = async (req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>📸 Collage Maker Bot is running!</h1><p>Configure this URL as a webhook in Telegram to start using the bot.</p>');
    return;
  }
  return handleWebhook(req, res);
};
