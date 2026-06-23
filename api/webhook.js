require('dotenv').config();
const { Bot, webhookCallback, InlineKeyboard, InputFile } = require('grammy');
const db = require('../lib/db');
const { createCollageBatches } = require('../lib/collage');

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
    `2. Choose a grid size (e.g., **2x2**, **3x3**, up to **6x6**) below to generate your collage.\n` +
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
    if (existingImages.length >= 100) {
      const keyboard = new InlineKeyboard()
        .text("🖼️ 2x2 Grid", "collage_grid_2")
        .text("🖼️ 3x3 Grid", "collage_grid_3")
        .row()
        .text("🖼️ 4x4 Grid", "collage_grid_4")
        .text("🖼️ 5x5 Grid", "collage_grid_5")
        .row()
        .text("🖼️ 6x6 Grid", "collage_grid_6")
        .text("❌ Clear & Restart", "collage_clear");

      const lastMsgId = await db.getLastMessageId(userId);
      if (lastMsgId) {
        await ctx.api.deleteMessage(ctx.chat.id, lastMsgId).catch(() => {});
      }

      const sentMsg = await ctx.reply(
        `⚠️ *Queue Limit Reached (Max: 100 photos)*\n\n` +
        `You already have 100 photos in your queue. Please generate your collage now, or click **Clear & Restart** to start fresh.`,
        {
          reply_markup: keyboard,
          parse_mode: 'Markdown'
        }
      );

      await db.setLastMessageId(userId, sentMsg.message_id);
      return;
    }

    // Telegram sends photos in an array of different sizes.
    // Choose the second largest size (if available) to optimize download speed and memory usage.
    const photoIdx = ctx.message.photo.length > 2 ? ctx.message.photo.length - 2 : ctx.message.photo.length - 1;
    const photo = ctx.message.photo[photoIdx];
    const fileId = photo.file_id;

    // Resolve download URL immediately to avoid Vercel serverless execution timeout during collage generation
    const file = await ctx.api.getFile(fileId);
    const downloadUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    // Save download URL to database
    await db.addImage(userId, downloadUrl);

    // Retrieve updated list to count
    const images = await db.getImages(userId);
    const count = images.length;

    // Inline buttons for controls (Grid options from 2x2 to 6x6)
    const keyboard = new InlineKeyboard()
      .text("🖼️ 2x2 Grid", "collage_grid_2")
      .text("🖼️ 3x3 Grid", "collage_grid_3")
      .row()
      .text("🖼️ 4x4 Grid", "collage_grid_4")
      .text("🖼️ 5x5 Grid", "collage_grid_5")
      .row()
      .text("🖼️ 6x6 Grid", "collage_grid_6")
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

// Handle grid layout generation
bot.callbackQuery(['collage_grid_2', 'collage_grid_3', 'collage_grid_4', 'collage_grid_5', 'collage_grid_6'], async (ctx) => {
  const userId = ctx.from.id;
  const action = ctx.callbackQuery.data; // e.g. "collage_grid_4"
  const gridDim = parseInt(action.split('_')[2], 10);

  try {
    const imageUrls = await db.getImages(userId);
    if (!imageUrls || imageUrls.length < 2) {
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

    // Clear user queue immediately to prevent concurrent retries from reusing the queue,
    // and to allow the user to queue new images without them being deleted or mixed up.
    await db.clearImages(userId);
    await db.clearLastMessageId(userId);

    // Generate collage buffers
    const collageBuffers = await createCollageBatches(imageUrls, gridDim);

    if (collageBuffers.length > 1) {
      // Send as photo album(s) (max 10 items per media group)
      const photoMediaList = collageBuffers.map((buffer, idx) => ({
        type: 'photo',
        media: new InputFile(buffer, `collage_${gridDim}x${gridDim}_part${idx + 1}.jpg`),
        caption: `Part ${idx + 1} of ${collageBuffers.length} (${gridDim}x${gridDim} Grid)`
      }));

      for (let i = 0; i < photoMediaList.length; i += 10) {
        const chunk = photoMediaList.slice(i, i + 10);
        await ctx.replyWithMediaGroup(chunk);
      }

      // Send as document album(s) (max 10 items per media group)
      const docMediaList = collageBuffers.map((buffer, idx) => ({
        type: 'document',
        media: new InputFile(buffer, `collage_${gridDim}x${gridDim}_part${idx + 1}_highres.jpg`),
        caption: `High-res Part ${idx + 1}`
      }));

      for (let i = 0; i < docMediaList.length; i += 10) {
        const chunk = docMediaList.slice(i, i + 10);
        await ctx.replyWithMediaGroup(chunk);
      }
    } else if (collageBuffers.length === 1) {
      // Single collage output: send photo and document individually for best presentation
      const buffer = collageBuffers[0];
      
      await ctx.replyWithPhoto(new InputFile(buffer, `collage_${gridDim}x${gridDim}.jpg`), {
        caption: `🎉 Quick preview of your ${gridDim}x${gridDim} collage (${imageUrls.length} photos):`,
      });

      await ctx.replyWithDocument(new InputFile(buffer, `collage_${gridDim}x${gridDim}_highres.jpg`), {
        caption: `💾 Here is the Full HD (uncompressed) file!`,
      });
    }

    // Delete status message
    await ctx.api.deleteMessage(ctx.chat.id, statusMessage.message_id).catch(() => {});

  } catch (error) {
    console.error("Error generating collage:", error);
    
    // Clear user queue so they don't get stuck in a broken loop
    await db.clearImages(userId).catch(() => {});
    await db.clearLastMessageId(userId).catch(() => {});

    await ctx.reply(
      "❌ *Error generating your collage.*\n\n" +
      "Make sure all uploaded photos are fresh and try again (we have reset your queue to prevent further errors).",
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
