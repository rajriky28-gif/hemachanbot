const Jimp = require('jimp');

/**
 * Downloads an image from a URL and loads it into a Jimp instance.
 * Using standard node fetch for maximum compatibility.
 * @param {string} url - The image URL to download.
 * @returns {Promise<Jimp>}
 */
async function downloadAndLoadImage(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return await Jimp.read(buffer);
  } catch (error) {
    console.error(`Failed to load image from URL ${url}:`, error);
    throw error;
  }
}

/**
 * Stitches multiple image URLs into a single collage.
 * @param {string[]} imageUrls - Array of image URLs.
 * @param {'horizontal' | 'vertical'} direction - Layout direction.
 * @returns {Promise<Buffer>} Collage image buffer.
 */
async function createCollage(imageUrls, direction = 'horizontal') {
  if (!imageUrls || imageUrls.length === 0) {
    throw new Error("No images provided for collage");
  }

  console.log(`Creating ${direction} collage with ${imageUrls.length} images...`);

  // Download and load all images in parallel
  const images = await Promise.all(imageUrls.map(url => downloadAndLoadImage(url)));

  const padding = 15; // Space between images (in pixels)
  const targetDimension = 2500; // Unified size boundary (height for horiz, width for vert)

  let totalWidth = 0;
  let totalHeight = 0;
  const processedImages = [];

  if (direction === 'horizontal') {
    // For horizontal: match all heights to targetDimension
    const targetHeight = targetDimension;

    for (const img of images) {
      const origW = img.getWidth();
      const origH = img.getHeight();
      
      // Compute width while keeping aspect ratio
      const newWidth = Math.round(origW * (targetHeight / origH));
      
      // Jimp resize
      img.resize(newWidth, targetHeight);
      processedImages.push(img);
      
      totalWidth += newWidth;
    }
    // Add padding between images
    totalWidth += padding * (images.length - 1);
    totalHeight = targetHeight;

  } else {
    // For vertical: match all widths to targetDimension
    const targetWidth = targetDimension;

    for (const img of images) {
      const origW = img.getWidth();
      const origH = img.getHeight();
      
      // Compute height while keeping aspect ratio
      const newHeight = Math.round(origH * (targetWidth / origW));
      
      img.resize(targetWidth, newHeight);
      processedImages.push(img);
      
      totalHeight += newHeight;
    }
    // Add padding between images
    totalHeight += padding * (images.length - 1);
    totalWidth = targetWidth;
  }

  // Create canvas (white background). Hex representation: 0xFFFFFFFF
  const collage = new Jimp(totalWidth, totalHeight, 0xFFFFFFFF);

  let offset = 0;
  for (const img of processedImages) {
    if (direction === 'horizontal') {
      collage.composite(img, offset, 0);
      offset += img.getWidth() + padding;
    } else {
      collage.composite(img, 0, offset);
      offset += img.getHeight() + padding;
    }
  }

  // Set high quality
  collage.quality(98);

  // Get buffer
  console.log("Stitching complete. Exporting collage buffer...");
  return await collage.getBufferAsync(Jimp.MIME_JPEG);
}

module.exports = {
  createCollage,
};
