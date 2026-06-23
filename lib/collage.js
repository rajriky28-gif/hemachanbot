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

  const P = 15; // padding between images (in pixels)
  const M = 15; // outer margin/border around the grid (in pixels)
  
  // Standardize cell size based on grid dimension G to keep final collage size controlled
  let W_cell = 600;
  let H_cell = 600;
  
  if (G === 2) {
    W_cell = 800;
    H_cell = 800;
  } else if (G === 3) {
    W_cell = 600;
    H_cell = 600;
  } else if (G === 4) {
    W_cell = 500;
    H_cell = 500;
  } else if (G === 5) {
    W_cell = 400;
    H_cell = 400;
  } else if (G === 6) {
    W_cell = 350;
    H_cell = 350;
  }

  const W_row = G * W_cell + (G - 1) * P;
  const K = imageUrls.length;
  const R = Math.ceil(K / G);
  const H_total = R * H_cell + (R - 1) * P + 2 * M;
  const W_total = W_row + 2 * M;

  console.log(`Grid config: ${G}x${G}, total images in batch: ${K}, rows needed: ${R}`);
  console.log(`Canvas dimensions: ${W_total}x${H_total}. Processing cells...`);

  const processedImages = [];

  for (let r = 0; r < R; r++) {
    const idxStart = r * G;
    const L = Math.min(G, K - idxStart);
    const Y = M + r * (H_cell + P);
    
    // Calculate exact cell widths and horizontal positions for this row to fill W_row perfectly
    const cellWidths = [];
    const leftPositions = [];
    let currentLeft = 0;
    const totalAvailWidth = W_row - (L - 1) * P;
    
    for (let i = 0; i < L; i++) {
      const nextLeftOffset = Math.round((i + 1) * (totalAvailWidth / L));
      const prevLeftOffset = Math.round(i * (totalAvailWidth / L));
      const w = nextLeftOffset - prevLeftOffset;
      
      cellWidths.push(w);
      leftPositions.push(currentLeft);
      currentLeft += w + P;
    }

    // Resize images for this row
    for (let i = 0; i < L; i++) {
      const imgIdx = idxStart + i;
      const buf = imageBuffers[imgIdx];
      const w = cellWidths[i];
      const left = M + leftPositions[i];
      
      const resizedBuf = await sharp(buf)
        .resize(w, H_cell, { fit: 'cover' })
        .toBuffer();
        
      processedImages.push({
        input: resizedBuf,
        left: left,
        top: Y
      });
    }
  }

  console.log("Canvas composite starting...");

  // Create canvas (white background)
  const canvas = sharp({
    create: {
      width: W_total,
      height: H_total,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  });

  // Composite images and output JPEG buffer
  console.log("Stitching complete. Exporting collage buffer...");
  return await canvas
    .composite(processedImages)
    .jpeg({ quality: 95 })
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
  const batchSize = G * G;
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
