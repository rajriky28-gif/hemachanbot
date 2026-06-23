const sharp = require('sharp');

/**
 * Downloads an image from a URL and loads it into a Buffer.
 * Using standard node fetch for maximum compatibility.
 * @param {string} url - The image URL to download.
 * @returns {Promise<Buffer>}
 */
async function downloadImage(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`Failed to load image from URL ${url}:`, error);
    throw error;
  }
}

/**
 * Stitches multiple image URLs into a single grid collage using sharp.
 * @param {string[]} imageUrls - Array of image URLs (max gridDim^2).
 * @param {number} gridDim - Grid dimension G (2 to 6).
 * @returns {Promise<Buffer>} Collage image buffer.
 */
async function createCollage(imageUrls, gridDim = 2) {
  if (!imageUrls || imageUrls.length === 0) {
    throw new Error("No images provided for collage");
  }

  const G = parseInt(gridDim, 10);
  if (isNaN(G) || G < 2 || G > 6) {
    throw new Error("Invalid grid dimension. Must be between 2 and 6.");
  }

  console.log(`Creating ${G}x${G} grid collage with ${imageUrls.length} images...`);

  // Download all images in parallel
  const imageBuffers = await Promise.all(imageUrls.map(url => downloadImage(url)));

  // Get metadata of the first image to calculate the aspect ratio, taking EXIF orientation into account
  const firstMetadata = await sharp(imageBuffers[0]).metadata();
  let firstWidth = firstMetadata.width || 1;
  let firstHeight = firstMetadata.height || 1;
  
  if (firstMetadata.orientation && firstMetadata.orientation >= 5 && firstMetadata.orientation <= 8) {
    firstWidth = firstMetadata.height || 1;
    firstHeight = firstMetadata.width || 1;
  }
  
  const aspect = firstWidth / firstHeight;

  const P = 15; // padding between images (in pixels)
  const M = 15; // outer margin/border around the grid (in pixels)
  
  // Standardize cell width based on grid dimension G to keep final collage high-res and sharp
  let W_cell = 1000;
  if (G === 2) {
    W_cell = 1200;
  } else if (G === 3) {
    W_cell = 1000;
  } else if (G === 4) {
    W_cell = 900;
  } else if (G === 5) {
    W_cell = 800;
  } else if (G === 6) {
    W_cell = 800;
  }

  // Calculate cell height dynamically to preserve the aspect ratio of the original images
  const H_cell = Math.round(W_cell / aspect);

  const W_row = G * W_cell + (G - 1) * P;
  const K = imageUrls.length;
  const R = Math.ceil(K / G);
  const H_total = R * H_cell + (R - 1) * P + 2 * M;
  const W_total = W_row + 2 * M;

  console.log(`Grid config: ${G}x${G}, total images in batch: ${K}, rows needed: ${R}`);
  console.log(`Canvas dimensions: ${W_total}x${H_total}. Processing cells...`);

  const processedImages = [];

  for (let idx = 0; idx < K; idx++) {
    const r = Math.floor(idx / G);
    const c = idx % G;
    
    const Y = M + r * (H_cell + P);
    const X = M + c * (W_cell + P);
    
    const buf = imageBuffers[idx];
    
    // Resize image to fit the cell exactly using 'contain' and auto-orient rotation.
    // This guarantees that no image is cropped or rotated sideways.
    const resizedBuf = await sharp(buf)
      .rotate()
      .resize(W_cell, H_cell, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0 }
      })
      .toBuffer();
      
    processedImages.push({
      input: resizedBuf,
      left: X,
      top: Y
    });
  }

  console.log("Canvas composite starting...");

  // Create canvas (black background for framing borders)
  const canvas = sharp({
    create: {
      width: W_total,
      height: H_total,
      channels: 3,
      background: { r: 0, g: 0, b: 0 }
    }
  });

  // Composite images and output JPEG buffer
  console.log("Stitching complete. Exporting collage buffer...");
  return await canvas
    .composite(processedImages)
    .jpeg({ quality: 98 })
    .toBuffer();
}

/**
 * Splits images into chunks based on grid capacity and generates a collage for each chunk.
 * @param {string[]} imageUrls - Array of all image URLs.
 * @param {number} gridDim - Grid dimension G (2 to 6).
 * @returns {Promise<Buffer[]>} Array of collage image buffers.
 */
async function createCollageBatches(imageUrls, gridDim = 2) {
  const G = parseInt(gridDim, 10);
  const batchSize = G * 2;
  const batches = [];
  
  for (let i = 0; i < imageUrls.length; i += batchSize) {
    batches.push(imageUrls.slice(i, i + batchSize));
  }
  
  console.log(`Split ${imageUrls.length} images into ${batches.length} batches of max size ${batchSize}.`);
  
  const collageBuffers = [];
  for (let i = 0; i < batches.length; i++) {
    console.log(`Processing batch ${i + 1}/${batches.length}...`);
    const buffer = await createCollage(batches[i], G);
    collageBuffers.push(buffer);
  }
  
  return collageBuffers;
}

module.exports = {
  createCollage,
  createCollageBatches
};
